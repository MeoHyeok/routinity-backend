import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { serverError } from "../_shared/errors.ts";
import { requestLogger } from "../_shared/log.ts";

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

      const start = `${date}T00:00:00.000Z`;
      const end = new Date(
        new Date(start).getTime() + 24 * 60 * 60 * 1000,
      ).toISOString();

      const { data, error } = await ctx.supabase
        .from("routine_logs")
        .select("id, type, timestamp, created_at")
        .gte("timestamp", start)
        .lt("timestamp", end)
        .order("timestamp", { ascending: true });

      if (error) {
        return log(serverError(error));
      }
      return log(Response.json(data, { status: 200 }));
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
