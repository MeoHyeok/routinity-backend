import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { computeScores, goalsExistingBy, type GoalWithCreatedAt, type RoutineLog } from "../_shared/scoring.ts";
import { summarizeWeek, type DailyScores } from "../_shared/weekly-report.ts";
import { buildMonthlyClaudePrompt, buildMonthlyTemplateReport, MONTHLY_WINDOW_DAYS } from "../_shared/monthly-report.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { serverError } from "../_shared/errors.ts";
import { requestLogger } from "../_shared/log.ts";
import { dateOnly, dayRange, extractSuggestedAction, generateWithClaude, GEMINI_MODEL } from "../_shared/ai-report.ts";
import { loadInsights } from "../_shared/insights.ts";
import {
  averageDayBreakdowns,
  averageRawActivities,
  computeDayBreakdown,
  computeRawActivity,
  toAverageTimeBreakdownField,
} from "../_shared/day-breakdown.ts";
import { computeDaySessions, sessionsByDate, SESSION_LOOKBACK_MS } from "../_shared/day-sessions.ts";
import { deriveWindowSuggestedAction } from "../_shared/suggested-action.ts";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const log = requestLogger("reports-monthly", req.method);

    if (req.method !== "GET") {
      return log(Response.json({ error: "method not allowed" }, { status: 405 }));
    }

    const userId = ctx.userClaims!.id;

    const rateLimited = await enforceRateLimit(ctx.supabase, "reports-monthly", 10, 60);
    if (rateLimited) return log(rateLimited);

    const today = dateOnly(new Date());
    const { start: todayStart, end: todayEnd } = dayRange(today);

    const cached = await ctx.supabase
      .from("ai_reports")
      .select("content, time_breakdown, suggested_action, generated_via, created_at")
      .eq("period", "monthly")
      .gte("created_at", todayStart)
      .lt("created_at", todayEnd)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached.error) {
      return log(serverError(cached.error));
    }

    const dateList: string[] = [];
    for (let i = MONTHLY_WINDOW_DAYS - 1; i >= 0; i--) {
      dateList.push(
        dateOnly(new Date(new Date(todayStart).getTime() - i * 24 * 60 * 60 * 1000)),
      );
    }
    const dateRange = { from: dateList[0], to: today };

    if (cached.data) {
      return log(Response.json(
        {
          period: "monthly",
          date_range: dateRange,
          content: cached.data.content,
          time_breakdown: cached.data.time_breakdown,
          suggested_action: cached.data.suggested_action,
          cached: true,
          generated_via: cached.data.generated_via,
        },
        { status: 200 },
      ));
    }

    const windowStart = dayRange(dateList[0]).start;
    // Look back an extra SESSION_LOOKBACK_MS before the window — see its doc
    // comment in day-sessions.ts for why a still-open session from before
    // dateList[0] would otherwise be invisible here and misclassified.
    const fetchStart = new Date(new Date(windowStart).getTime() - SESSION_LOOKBACK_MS).toISOString();

    const [goalsResult, logsResult] = await Promise.all([
      ctx.supabase.from("goals").select("target_type, target_value, created_at"),
      ctx.supabase
        .from("routine_logs")
        .select("type, timestamp")
        .gte("timestamp", fetchStart)
        .lt("timestamp", todayEnd)
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
    // boundary — see reports-weekly for the full rationale.
    const sessionMap = sessionsByDate(computeDaySessions(allLogs));

    const dailyScores: DailyScores[] = [];
    const dayBreakdowns = [];
    const rawActivities = [];
    for (const date of dateList) {
      const dayLogs = sessionMap.get(date)?.logs ?? [];
      // Only score goals that existed by this day — see goalsExistingBy's
      // doc comment (same fix applied to /scores, /insights, /reports-weekly).
      const goalsAsOfDay = goalsExistingBy(goals, dayRange(date).end);
      dailyScores.push({ date, scores: computeScores(goalsAsOfDay, dayLogs) });
      const dayBreakdown = computeDayBreakdown(dayLogs);
      dayBreakdowns.push(dayBreakdown);
      rawActivities.push(dayBreakdown === null ? computeRawActivity(dayLogs) : null);
    }
    const breakdown = averageDayBreakdowns(dayBreakdowns);
    // Goal-less fallback — see reports-daily/index.ts for the rationale.
    const rawActivity = breakdown === null ? averageRawActivities(rawActivities) : null;

    const stats = summarizeWeek(dailyScores);

    // Same enrichment-not-core rationale as /reports-weekly and
    // /reports-daily — a pattern-lookup failure shouldn't fail the report.
    const insightsResult = await loadInsights(ctx.supabase, today);
    if (insightsResult.error) {
      console.error(insightsResult.error.message);
    }
    const insights = insightsResult.data;

    const claudeRaw = await generateWithClaude(buildMonthlyClaudePrompt(stats, insights, breakdown, rawActivity));
    const claudeParsed = claudeRaw !== null ? extractSuggestedAction(claudeRaw) : null;
    const content = claudeParsed?.content ?? buildMonthlyTemplateReport(stats, insights, breakdown, rawActivity);
    const generatedVia = claudeRaw !== null ? GEMINI_MODEL : "template";
    const timeBreakdownField = toAverageTimeBreakdownField(breakdown);
    const suggestedAction = claudeParsed?.suggestedAction ?? deriveWindowSuggestedAction(stats, breakdown !== null || rawActivity !== null);

    const insert = await ctx.supabaseAdmin
      .from("ai_reports")
      .insert({ user_id: userId, period: "monthly", content, time_breakdown: timeBreakdownField, suggested_action: suggestedAction, generated_via: generatedVia })
      .select("content, time_breakdown, suggested_action, generated_via")
      .single();

    if (insert.error) {
      // Same concurrent-cache-miss race as /reports-weekly — see that
      // function for the full rationale.
      if (insert.error.code === "23505") {
        const raced = await ctx.supabase
          .from("ai_reports")
          .select("content, time_breakdown, suggested_action, generated_via")
          .eq("period", "monthly")
          .gte("created_at", todayStart)
          .lt("created_at", todayEnd)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (raced.data) {
          return log(Response.json(
            {
              period: "monthly",
              date_range: dateRange,
              content: raced.data.content,
              time_breakdown: raced.data.time_breakdown,
              suggested_action: raced.data.suggested_action,
              cached: true,
              generated_via: raced.data.generated_via,
            },
            { status: 200 },
          ));
        }
      }
      return log(serverError(insert.error));
    }

    return log(Response.json(
      {
        period: "monthly",
        date_range: dateRange,
        content: insert.data.content,
        time_breakdown: insert.data.time_breakdown,
        suggested_action: insert.data.suggested_action,
        cached: false,
        generated_via: insert.data.generated_via,
      },
      { status: 200 },
    ));
  }),
};
