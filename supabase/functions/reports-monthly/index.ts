import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { computeScores, goalsExistingBy, type GoalWithCreatedAt, type RoutineLog } from "../_shared/scoring.ts";
import { summarizeWeek, type DailyScores } from "../_shared/weekly-report.ts";
import { buildMonthlyClaudePrompt, buildMonthlyTemplateReport, MONTHLY_WINDOW_DAYS } from "../_shared/monthly-report.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { serverError } from "../_shared/errors.ts";
import { requestLogger } from "../_shared/log.ts";
import { dateOnly, dayRange, filterLogsInRange, generateWithClaude } from "../_shared/ai-report.ts";
import { loadInsights } from "../_shared/insights.ts";
import { averageDayBreakdowns, computeDayBreakdown } from "../_shared/day-breakdown.ts";

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
      .select("content, created_at")
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
        { period: "monthly", date_range: dateRange, content: cached.data.content, cached: true },
        { status: 200 },
      ));
    }

    const windowStart = dayRange(dateList[0]).start;

    const [goalsResult, logsResult] = await Promise.all([
      ctx.supabase.from("goals").select("target_type, target_value, created_at"),
      ctx.supabase
        .from("routine_logs")
        .select("type, timestamp")
        .gte("timestamp", windowStart)
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

    const dailyScores: DailyScores[] = [];
    const dayBreakdowns = [];
    for (const date of dateList) {
      const { start, end } = dayRange(date);
      const dayLogs = filterLogsInRange(allLogs, start, end);
      // Only score goals that existed by this day — see goalsExistingBy's
      // doc comment (same fix applied to /scores, /insights, /reports-weekly).
      const goalsAsOfDay = goalsExistingBy(goals, end);
      dailyScores.push({ date, scores: computeScores(goalsAsOfDay, dayLogs) });
      dayBreakdowns.push(computeDayBreakdown(dayLogs));
    }
    const breakdown = averageDayBreakdowns(dayBreakdowns);

    const stats = summarizeWeek(dailyScores);

    // Same enrichment-not-core rationale as /reports-weekly and
    // /reports-daily — a pattern-lookup failure shouldn't fail the report.
    const insightsResult = await loadInsights(ctx.supabase, today);
    if (insightsResult.error) {
      console.error(insightsResult.error.message);
    }
    const insights = insightsResult.data;

    const claudeText = await generateWithClaude(buildMonthlyClaudePrompt(stats, insights, breakdown));
    const content = claudeText ?? buildMonthlyTemplateReport(stats, insights, breakdown);
    const generatedVia = claudeText ? "claude" : "template";

    const insert = await ctx.supabaseAdmin
      .from("ai_reports")
      .insert({ user_id: userId, period: "monthly", content })
      .select("content")
      .single();

    if (insert.error) {
      // Same concurrent-cache-miss race as /reports-weekly — see that
      // function for the full rationale.
      if (insert.error.code === "23505") {
        const raced = await ctx.supabase
          .from("ai_reports")
          .select("content")
          .eq("period", "monthly")
          .gte("created_at", todayStart)
          .lt("created_at", todayEnd)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (raced.data) {
          return log(Response.json(
            { period: "monthly", date_range: dateRange, content: raced.data.content, cached: true },
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
        cached: false,
        generated_via: generatedVia,
      },
      { status: 200 },
    ));
  }),
};
