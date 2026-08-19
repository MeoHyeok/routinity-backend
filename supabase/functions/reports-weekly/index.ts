import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { computeScores, goalsExistingBy, type GoalWithCreatedAt, type RoutineLog } from "../_shared/scoring.ts";
import {
  buildClaudePrompt,
  buildTemplateReport,
  summarizeWeek,
  type DailyScores,
} from "../_shared/weekly-report.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { serverError } from "../_shared/errors.ts";
import { requestLogger } from "../_shared/log.ts";
import { dateOnly, dayRange, extractSuggestedAction, generateWithClaude } from "../_shared/ai-report.ts";
import { loadInsights } from "../_shared/insights.ts";
import { averageDayBreakdowns, computeDayBreakdown, toAverageTimeBreakdownField } from "../_shared/day-breakdown.ts";
import { computeDaySessions, sessionsByDate, SESSION_LOOKBACK_MS } from "../_shared/day-sessions.ts";
import { deriveWindowSuggestedAction } from "../_shared/suggested-action.ts";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const log = requestLogger("reports-weekly", req.method);

    if (req.method !== "GET") {
      return log(Response.json({ error: "method not allowed" }, { status: 405 }));
    }

    const userId = ctx.userClaims!.id;

    const rateLimited = await enforceRateLimit(ctx.supabase, "reports-weekly", 10, 60);
    if (rateLimited) return log(rateLimited);

    const today = dateOnly(new Date());
    const { start: todayStart, end: todayEnd } = dayRange(today);

    const cached = await ctx.supabase
      .from("ai_reports")
      .select("content, time_breakdown, suggested_action, created_at")
      .eq("period", "weekly")
      .gte("created_at", todayStart)
      .lt("created_at", todayEnd)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached.error) {
      return log(serverError(cached.error));
    }
    if (cached.data) {
      return log(Response.json(
        {
          period: "weekly",
          content: cached.data.content,
          time_breakdown: cached.data.time_breakdown,
          suggested_action: cached.data.suggested_action,
          cached: true,
        },
        { status: 200 },
      ));
    }

    const dateList: string[] = [];
    for (let i = 6; i >= 0; i--) {
      dateList.push(
        dateOnly(new Date(new Date(todayStart).getTime() - i * 24 * 60 * 60 * 1000)),
      );
    }
    const weekStart = dayRange(dateList[0]).start;
    // Look back an extra SESSION_LOOKBACK_MS before the window so a still-open
    // session from before dateList[0] isn't invisible here — see its doc
    // comment in day-sessions.ts for why that would misclassify a wake log.
    const fetchStart = new Date(new Date(weekStart).getTime() - SESSION_LOOKBACK_MS).toISOString();
    const weekEnd = todayEnd;

    const [goalsResult, logsResult] = await Promise.all([
      ctx.supabase.from("goals").select("target_type, target_value, created_at"),
      ctx.supabase
        .from("routine_logs")
        .select("type, timestamp")
        .gte("timestamp", fetchStart)
        .lt("timestamp", weekEnd)
        .order("timestamp", { ascending: true }),
    ]);

    if (goalsResult.error) {
      return log(serverError(goalsResult.error));
    }
    if (logsResult.error) {
      return log(serverError(logsResult.error));
    }

    const goals: GoalWithCreatedAt[] = goalsResult.data ?? [];
    const allLogs: RoutineLog[] = logsResult.data ?? [];

    // Bucket by wake-to-sleep session (day-sessions.ts), not a fixed clock
    // boundary — a late sleeper's post-midnight "sleep" log still closes the
    // same session their "wake" opened instead of splitting onto the next day.
    const sessionMap = sessionsByDate(computeDaySessions(allLogs));

    const dailyScores: DailyScores[] = [];
    const dayBreakdowns = [];
    for (const date of dateList) {
      const dayLogs = sessionMap.get(date)?.logs ?? [];
      // Only score goals that existed by this day — see goalsExistingBy's
      // doc comment (same fix applied to /scores, /insights, /reports-monthly).
      const goalsAsOfDay = goalsExistingBy(goals, dayRange(date).end);
      dailyScores.push({ date, scores: computeScores(goalsAsOfDay, dayLogs) });
      dayBreakdowns.push(computeDayBreakdown(dayLogs));
    }
    const breakdown = averageDayBreakdowns(dayBreakdowns);

    const stats = summarizeWeek(dailyScores);

    // Patterns are an enrichment, not core to report generation — if this
    // fails, log it and fall back to a plain report rather than 500ing the
    // whole request over it.
    const insightsResult = await loadInsights(ctx.supabase, today);
    if (insightsResult.error) {
      console.error(insightsResult.error.message);
    }
    const insights = insightsResult.data;

    const claudeRaw = await generateWithClaude(buildClaudePrompt(stats, insights, breakdown));
    const claudeParsed = claudeRaw !== null ? extractSuggestedAction(claudeRaw) : null;
    const content = claudeParsed?.content ?? buildTemplateReport(stats, insights, breakdown);
    const generatedVia = claudeRaw !== null ? "claude" : "template";
    const timeBreakdownField = toAverageTimeBreakdownField(breakdown);
    const suggestedAction = claudeParsed?.suggestedAction ?? deriveWindowSuggestedAction(stats);

    const insert = await ctx.supabaseAdmin
      .from("ai_reports")
      .insert({ user_id: userId, period: "weekly", content, time_breakdown: timeBreakdownField, suggested_action: suggestedAction })
      .select("content, time_breakdown, suggested_action")
      .single();

    if (insert.error) {
      // A concurrent request for the same user can win the "cache miss" race
      // and insert first; the DB's one-report-per-UTC-day unique constraint
      // then rejects this insert. Rather than 500, return what the other
      // request already cached instead of forcing the client to retry.
      if (insert.error.code === "23505") {
        const raced = await ctx.supabase
          .from("ai_reports")
          .select("content, time_breakdown, suggested_action")
          .eq("period", "weekly")
          .gte("created_at", todayStart)
          .lt("created_at", todayEnd)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (raced.data) {
          return log(Response.json(
            {
              period: "weekly",
              content: raced.data.content,
              time_breakdown: raced.data.time_breakdown,
              suggested_action: raced.data.suggested_action,
              cached: true,
            },
            { status: 200 },
          ));
        }
      }
      return log(serverError(insert.error));
    }

    return log(Response.json(
      {
        period: "weekly",
        content: insert.data.content,
        time_breakdown: insert.data.time_breakdown,
        suggested_action: insert.data.suggested_action,
        cached: false,
        generated_via: generatedVia,
      },
      { status: 200 },
    ));
  }),
};
