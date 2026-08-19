import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { computeDailyScore, computeScores, goalsExistingBy, type GoalWithCreatedAt } from "../_shared/scoring.ts";
import { computeDaySessions, sessionsByDate, SESSION_LOOKBACK_MS } from "../_shared/day-sessions.ts";
import { dayRange } from "../_shared/ai-report.ts";
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

    // Fetch from this KST day's start through a generous 48h lookahead so a
    // late sleeper's "sleep" log (possibly well past this day's midnight)
    // still gets captured — computeDaySessions below picks out exactly the
    // session that belongs to `date` regardless of how far its close runs.
    // Also fetch from SESSION_LOOKBACK_MS before that start so a still-open
    // session from before this day isn't invisible here — see its doc
    // comment for why that's needed for computeDaySessions to agree with
    // what other endpoints see.
    const { start, end: dayEnd } = dayRange(date);
    const fetchStart = new Date(new Date(start).getTime() - SESSION_LOOKBACK_MS).toISOString();
    const fetchEnd = new Date(new Date(start).getTime() + 48 * 60 * 60 * 1000).toISOString();

    const [goalsResult, logsResult] = await Promise.all([
      ctx.supabase.from("goals").select("target_type, target_value, created_at"),
      ctx.supabase
        .from("routine_logs")
        .select("type, timestamp")
        .gte("timestamp", fetchStart)
        .lt("timestamp", fetchEnd)
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
    const goalsAsOfDate = goalsExistingBy(goals, dayEnd);
    const session = sessionsByDate(computeDaySessions(logsResult.data ?? [])).get(date);
    const scores = computeScores(goalsAsOfDate, session?.logs ?? []);
    const daily_score = computeDailyScore(scores);
    return log(Response.json({ date, daily_score, scores }, { status: 200 }));
  }),
};
