import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { serverError } from "../_shared/errors.ts";
import { requestLogger } from "../_shared/log.ts";
import { dayRange } from "../_shared/ai-report.ts";
import { computeDaySessions, sessionsByDate, SESSION_LOOKBACK_MS } from "../_shared/day-sessions.ts";

// "meal" (single-point) is deprecated in favor of meal_start/meal_end (a
// paired duration, like study) — still readable via GET since the DB
// constraint keeps it valid, just no longer accepted on new POSTs.
const ALLOWED_TYPES = new Set(["wake", "sleep", "meal_start", "meal_end", "study_start", "study_end"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const log = requestLogger("logs", req.method);

    const rateLimited = await enforceRateLimit(ctx.supabase, "logs", 60, 60);
    if (rateLimited) return log(rateLimited);

    if (req.method === "POST") {
      let body: { type?: string; timestamp?: string };
      try {
        body = await req.json();
      } catch {
        return log(Response.json({ error: "invalid JSON body" }, { status: 400 }));
      }

      if (!body.type || !ALLOWED_TYPES.has(body.type)) {
        return log(Response.json(
          { error: `type must be one of: ${[...ALLOWED_TYPES].join(", ")}` },
          { status: 400 },
        ));
      }
      if (!body.timestamp || Number.isNaN(Date.parse(body.timestamp))) {
        return log(Response.json(
          { error: "timestamp must be a valid ISO 8601 string" },
          { status: 400 },
        ));
      }

      const { data, error } = await ctx.supabase
        .from("routine_logs")
        .insert({
          user_id: ctx.userClaims!.id,
          type: body.type,
          timestamp: body.timestamp,
        })
        .select("id, type, timestamp, created_at")
        .single();

      if (error) {
        return log(serverError(error));
      }
      return log(Response.json(data, { status: 201 }));
    }

    if (req.method === "GET") {
      const date = new URL(req.url).searchParams.get("date");
      if (!date || !DATE_RE.test(date)) {
        return log(Response.json(
          { error: "date query param is required, format YYYY-MM-DD" },
          { status: 400 },
        ));
      }

      // Same wake-to-sleep session as /scores, /reports-daily, etc. (see
      // day-sessions.ts) rather than a fixed clock boundary, so a log this
      // endpoint returns for `date` always matches what those endpoints
      // scored it under. Fetch from this KST day's start through a 48h
      // lookahead so a late sleeper's "sleep" log — however far past this
      // day's midnight it falls — is still captured. Also fetch from
      // SESSION_LOOKBACK_MS before that start, or a still-open session from
      // before this day (no `sleep` logged yet) would be invisible here and
      // its first in-window `wake` misread as opening a brand new session —
      // see SESSION_LOOKBACK_MS's doc comment.
      const { start } = dayRange(date);
      const fetchStart = new Date(new Date(start).getTime() - SESSION_LOOKBACK_MS).toISOString();
      const fetchEnd = new Date(new Date(start).getTime() + 48 * 60 * 60 * 1000).toISOString();

      const { data, error } = await ctx.supabase
        .from("routine_logs")
        .select("id, type, timestamp, created_at")
        .gte("timestamp", fetchStart)
        .lt("timestamp", fetchEnd)
        .order("timestamp", { ascending: true });

      if (error) {
        return log(serverError(error));
      }
      const session = sessionsByDate(computeDaySessions(data ?? [])).get(date);
      return log(Response.json(session?.logs ?? [], { status: 200 }));
    }

    if (req.method === "DELETE") {
      const id = new URL(req.url).searchParams.get("id");
      if (!id || !UUID_RE.test(id)) {
        return log(Response.json(
          { error: "id query param is required and must be a uuid" },
          { status: 400 },
        ));
      }

      const { data, error } = await ctx.supabase
        .from("routine_logs")
        .delete()
        .eq("id", id)
        .select("id");

      if (error) {
        return log(serverError(error));
      }
      if (!data || data.length === 0) {
        return log(Response.json({ error: "log not found" }, { status: 404 }));
      }
      return log(new Response(null, { status: 204 }));
    }

    return log(Response.json({ error: "method not allowed" }, { status: 405 }));
  }),
};
