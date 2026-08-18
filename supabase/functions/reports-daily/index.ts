import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { computeDailyScore, computeScores, type Goal, type RoutineLog } from "../_shared/scoring.ts";
import { buildDailyClaudePrompt, buildDailyTemplateReport } from "../_shared/daily-report.ts";
import { dateOnly, dayRange, extractSuggestedAction, generateWithClaude } from "../_shared/ai-report.ts";
import { loadInsights } from "../_shared/insights.ts";
import { computeDayBreakdown, toTimeBreakdownField } from "../_shared/day-breakdown.ts";
import { computeDaySessions, sessionsByDate } from "../_shared/day-sessions.ts";
import { deriveDailySuggestedAction } from "../_shared/suggested-action.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { serverError } from "../_shared/errors.ts";
import { requestLogger } from "../_shared/log.ts";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const log = requestLogger("reports-daily", req.method);

    if (req.method !== "GET") {
      return log(Response.json({ error: "method not allowed" }, { status: 405 }));
    }

    const userId = ctx.userClaims!.id;

    const rateLimited = await enforceRateLimit(ctx.supabase, "reports-daily", 10, 60);
    if (rateLimited) return log(rateLimited);

    const today = dateOnly(new Date());
    const { start: todayStart, end: todayEnd } = dayRange(today);

    const cached = await ctx.supabase
      .from("ai_reports")
      .select("content, time_breakdown, suggested_action, created_at")
      .eq("period", "daily")
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
          period: "daily",
          date: today,
          content: cached.data.content,
          time_breakdown: cached.data.time_breakdown,
          suggested_action: cached.data.suggested_action,
          cached: true,
        },
        { status: 200 },
      ));
    }

    const [goalsResult, logsResult] = await Promise.all([
      ctx.supabase.from("goals").select("target_type, target_value"),
      ctx.supabase
        .from("routine_logs")
        .select("type, timestamp")
        .gte("timestamp", todayStart)
        .lt("timestamp", todayEnd)
        .order("timestamp", { ascending: true }),
    ]);

    if (goalsResult.error) {
      return log(serverError(goalsResult.error));
    }
    if (logsResult.error) {
      return log(serverError(logsResult.error));
    }

    const goals: Goal[] = goalsResult.data ?? [];
    const logs: RoutineLog[] = logsResult.data ?? [];
    // "Today" is the wake-to-sleep session labeled with today's KST date,
    // not every log that landed within the UTC/KST clock window — see
    // day-sessions.ts. Still open (no session for `today`) until the user
    // logs a fresh "wake."
    const todaySession = sessionsByDate(computeDaySessions(logs)).get(today);
    const sessionLogs = todaySession?.logs ?? [];

    const scores = computeScores(goals, sessionLogs);
    const dailyScore = computeDailyScore(scores);
    const breakdown = computeDayBreakdown(sessionLogs);

    // Same enrichment-not-core rationale as /reports-weekly: don't fail the
    // whole report over a pattern-lookup error.
    const insightsResult = await loadInsights(ctx.supabase, today);
    if (insightsResult.error) {
      console.error(insightsResult.error.message);
    }
    const insights = insightsResult.data;

    const claudeRaw = await generateWithClaude(buildDailyClaudePrompt(scores, dailyScore, insights, breakdown));
    const claudeParsed = claudeRaw !== null ? extractSuggestedAction(claudeRaw) : null;
    const content = claudeParsed?.content ?? buildDailyTemplateReport(scores, dailyScore, insights, breakdown);
    const generatedVia = claudeRaw !== null ? "claude" : "template";
    const timeBreakdownField = toTimeBreakdownField(breakdown);
    const suggestedAction = claudeParsed?.suggestedAction ?? deriveDailySuggestedAction(scores);

    const insert = await ctx.supabaseAdmin
      .from("ai_reports")
      .insert({ user_id: userId, period: "daily", content, time_breakdown: timeBreakdownField, suggested_action: suggestedAction })
      .select("content, time_breakdown, suggested_action")
      .single();

    if (insert.error) {
      // Same concurrent-cache-miss race as /reports-weekly — see that
      // function for the full rationale.
      if (insert.error.code === "23505") {
        const raced = await ctx.supabase
          .from("ai_reports")
          .select("content, time_breakdown, suggested_action")
          .eq("period", "daily")
          .gte("created_at", todayStart)
          .lt("created_at", todayEnd)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (raced.data) {
          return log(Response.json(
            {
              period: "daily",
              date: today,
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
        period: "daily",
        date: today,
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
