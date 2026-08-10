import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const ALLOWED_TYPES = new Set(["wake", "meal", "study_start", "study_end"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "POST") {
      let body: { type?: string; timestamp?: string };
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
      }

      if (!body.type || !ALLOWED_TYPES.has(body.type)) {
        return Response.json(
          { error: `type must be one of: ${[...ALLOWED_TYPES].join(", ")}` },
          { status: 400 },
        );
      }
      if (!body.timestamp || Number.isNaN(Date.parse(body.timestamp))) {
        return Response.json(
          { error: "timestamp must be a valid ISO 8601 string" },
          { status: 400 },
        );
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
        return Response.json({ error: error.message }, { status: 500 });
      }
      return Response.json(data, { status: 201 });
    }

    if (req.method === "GET") {
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

      const { data, error } = await ctx.supabase
        .from("routine_logs")
        .select("id, type, timestamp, created_at")
        .gte("timestamp", start)
        .lt("timestamp", end)
        .order("timestamp", { ascending: true });

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }
      return Response.json(data, { status: 200 });
    }

    return Response.json({ error: "method not allowed" }, { status: 405 });
  }),
};
