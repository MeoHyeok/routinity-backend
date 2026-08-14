import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { computeDailyScore, computeScores, type Goal, type RoutineLog } from "../_shared/scoring.ts";
import { buildDailyClaudePrompt, buildDailyTemplateReport } from "../_shared/daily-report.ts";
import { dateOnly, dayRange, generateWithClaude } from "../_shared/ai-report.ts";
import { loadInsights } from "../_shared/insights.ts";
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
      .select("content, created_at")
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
        { period: "daily", date: today, content: cached.data.content, cached: true },
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

    const scores = computeScores(goals, logs);
    const dailyScore = computeDailyScore(scores);

    // Same enrichment-not-core rationale as /reports-weekly: don't fail the
    // whole report over a pattern-lookup error.
    const insightsResult = await loadInsights(ctx.supabase, today);
    if (insightsResult.error) {
      console.error(insightsResult.error.message);
    }
    const insights = insightsResult.data;

    const claudeText = await generateWithClaude(buildDailyClaudePrompt(scores, dailyScore, insights));
    const content = claudeText ?? buildDailyTemplateReport(scores, dailyScore, insights);
    const generatedVia = claudeText ? "claude" : "template";

    const insert = await ctx.supabaseAdmin
      .from("ai_reports")
      .insert({ user_id: userId, period: "daily", content })
      .select("content")
      .single();

    if (insert.error) {
      // Same concurrent-cache-miss race as /reports-weekly — see that
      // function for the full rationale.
      if (insert.error.code === "23505") {
        const raced = await ctx.supabase
          .from("ai_reports")
          .select("content")
          .eq("period", "daily")
          .gte("created_at", todayStart)
          .lt("created_at", todayEnd)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (raced.data) {
          return log(Response.json(
            { period: "daily", date: today, content: raced.data.content, cached: true },
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
        cached: false,
        generated_via: generatedVia,
      },
      { status: 200 },
    ));
  }),
};
