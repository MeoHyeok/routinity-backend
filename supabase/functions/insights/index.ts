import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  computeDailyScore,
  computeScores,
  goalsExistingBy,
  type GoalWithCreatedAt,
  type RoutineLog,
} from "../_shared/scoring.ts";
import { computeInsights, type DayScore } from "../_shared/insights.ts";
import { dateOnly, dayRange, filterLogsInRange } from "../_shared/ai-report.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { serverError } from "../_shared/errors.ts";
import { requestLogger } from "../_shared/log.ts";

const WINDOW_DAYS = 28;

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const log = requestLogger("insights", req.method);

    if (req.method !== "GET") {
      return log(Response.json({ error: "method not allowed" }, { status: 405 }));
    }

    const rateLimited = await enforceRateLimit(ctx.supabase, "insights", 20, 60);
    if (rateLimited) return log(rateLimited);

    const today = dateOnly(new Date());
    const { start: todayStart, end: todayEnd } = dayRange(today);

    const dateList: string[] = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      dateList.push(
        dateOnly(new Date(new Date(todayStart).getTime() - i * 24 * 60 * 60 * 1000)),
      );
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

    const dayScores: DayScore[] = dateList.map((date) => {
      const { start, end } = dayRange(date);
      // Only score goals that existed by this day — a day before the user
      // set a goal shouldn't read as "didn't log it" (see the migration
      // note in 20260814080000_goals_created_at.sql for why this matters).
      const goalsAsOfDay = goalsExistingBy(goals, end);
      const dayLogs = filterLogsInRange(allLogs, start, end);
      const scores = computeScores(goalsAsOfDay, dayLogs);
      return { date, dailyScore: computeDailyScore(scores) };
    });

    const insights = computeInsights(dayScores, today);

    return log(Response.json(
      {
        date_range: { from: dateList[0], to: today },
        ...insights,
      },
      { status: 200 },
    ));
  }),
};
