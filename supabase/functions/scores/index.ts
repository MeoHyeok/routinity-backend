import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { computeDailyScore, computeScores, goalsExistingBy, type GoalWithCreatedAt } from "../_shared/scoring.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { serverError } from "../_shared/errors.ts";
import { requestLogger } from "../_shared/log.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const log = requestLogger("scores", req.method);

    if (req.method !== "GET") {
      return log(Response.json({ error: "method not allowed" }, { status: 405 }));
    }

    const rateLimited = await enforceRateLimit(ctx.supabase, "scores", 60, 60);
    if (rateLimited) return log(rateLimited);

    const date = new URL(req.url).searchParams.get("date");
    if (!date || !DATE_RE.test(date)) {
      return log(Response.json(
        { error: "date query param is required, format YYYY-MM-DD" },
        { status: 400 },
      ));
    }

    const start = `${date}T00:00:00.000Z`;
    const end = new Date(
      new Date(start).getTime() + 24 * 60 * 60 * 1000,
    ).toISOString();

    const [goalsResult, logsResult] = await Promise.all([
      ctx.supabase.from("goals").select("target_type, target_value, created_at"),
      ctx.supabase
        .from("routine_logs")
        .select("type, timestamp")
        .gte("timestamp", start)
        .lt("timestamp", end)
        .order("timestamp", { ascending: true }),
    ]);

    if (goalsResult.error) {
      return log(serverError(goalsResult.error));
    }
    if (logsResult.error) {
      return log(serverError(logsResult.error));
    }

    const goals: GoalWithCreatedAt[] = goalsResult.data ?? [];
    // A goal set after this date shouldn't score against it — see the
    // goalsExistingBy doc comment for why (same fix applied to /insights,
    // /reports-weekly, /reports-monthly).
    const goalsAsOfDate = goalsExistingBy(goals, end);
    const scores = computeScores(goalsAsOfDate, logsResult.data ?? []);
    const daily_score = computeDailyScore(scores);
    return log(Response.json({ date, daily_score, scores }, { status: 200 }));
  }),
};
