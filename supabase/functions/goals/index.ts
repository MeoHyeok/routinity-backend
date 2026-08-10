import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "POST") {
      let body: { target_type?: string; target_value?: string };
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
      }

      if (!body.target_type || typeof body.target_type !== "string") {
        return Response.json(
          { error: "target_type is required" },
          { status: 400 },
        );
      }
      if (!body.target_value || typeof body.target_value !== "string") {
        return Response.json(
          { error: "target_value is required" },
          { status: 400 },
        );
      }

      const { data, error } = await ctx.supabase
        .from("goals")
        .upsert(
          {
            user_id: ctx.userClaims!.id,
            target_type: body.target_type,
            target_value: body.target_value,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,target_type" },
        )
        .select("id, target_type, target_value, updated_at")
        .single();

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }
      return Response.json(data, { status: 200 });
    }

    if (req.method === "GET") {
      const { data, error } = await ctx.supabase
        .from("goals")
        .select("id, target_type, target_value, updated_at")
        .order("target_type", { ascending: true });

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }
      return Response.json(data, { status: 200 });
    }

    return Response.json({ error: "method not allowed" }, { status: 405 });
  }),
};
