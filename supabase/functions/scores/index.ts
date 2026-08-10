import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { computeScores } from "../_shared/scoring.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "GET") {
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }

    const rateLimited = await enforceRateLimit(
      ctx.supabase,
      ctx.userClaims!.id,
      "scores",
      60,
      60,
    );
    if (rateLimited) return rateLimited;

    const date = new URL(req.url).searchParams.get("date");
    if (!date || !DATE_RE.test(date)) {
      return Response.json(
        { error: "date query param is required, format YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const start = `${date}T00:00:00.000Z`;
    const end = new Date(
      new Date(start).getTime() + 24 * 60 * 60 * 1000,
    ).toISOString();

    const [goalsResult, logsResult] = await Promise.all([
      ctx.supabase.from("goals").select("target_type, target_value"),
      ctx.supabase
        .from("routine_logs")
        .select("type, timestamp")
        .gte("timestamp", start)
        .lt("timestamp", end),
    ]);

    if (goalsResult.error) {
      return Response.json({ error: goalsResult.error.message }, { status: 500 });
    }
    if (logsResult.error) {
      return Response.json({ error: logsResult.error.message }, { status: 500 });
    }

    const scores = computeScores(goalsResult.data ?? [], logsResult.data ?? []);
    return Response.json({ date, scores }, { status: 200 });
  }),
};
