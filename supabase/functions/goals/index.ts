import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { serverError } from "../_shared/errors.ts";

// wake_time/study_duration은 scoring.ts와 weekly-report.ts가 특정 형식을
// 가정하고 파싱하므로(HH:MM 비교, 분 단위 정수), 여기서 미리 형식을 강제해
// 채점이 조용히 틀어지는 걸 막는다. 그 외 target_type은 자유 문자열 허용.
const TARGET_VALUE_FORMATS: Record<string, RegExp> = {
  wake_time: /^([01]\d|2[0-3]):[0-5]\d$/,
  study_duration: /^[1-9]\d*$/,
};

// target_type is intentionally free-form (future goal types shouldn't need a
// migration), but it's still unauthenticated user input going straight into a
// row key — cap the length so a user can't balloon storage with huge strings
// or an unbounded number of distinct target_type rows.
const MAX_TARGET_TYPE_LENGTH = 50;
const MAX_TARGET_VALUE_LENGTH = 200;

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const rateLimited = await enforceRateLimit(ctx.supabase, "goals", 20, 60);
    if (rateLimited) return rateLimited;

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
      if (body.target_type.length > MAX_TARGET_TYPE_LENGTH) {
        return Response.json(
          { error: `target_type must be at most ${MAX_TARGET_TYPE_LENGTH} characters` },
          { status: 400 },
        );
      }
      if (body.target_value.length > MAX_TARGET_VALUE_LENGTH) {
        return Response.json(
          { error: `target_value must be at most ${MAX_TARGET_VALUE_LENGTH} characters` },
          { status: 400 },
        );
      }
      const format = TARGET_VALUE_FORMATS[body.target_type];
      if (format && !format.test(body.target_value)) {
        return Response.json(
          {
            error:
              body.target_type === "wake_time"
                ? "target_value must be HH:MM (24h)"
                : "target_value must be a positive integer (minutes)",
          },
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
        return serverError(error);
      }
      return Response.json(data, { status: 200 });
    }

    if (req.method === "GET") {
      const { data, error } = await ctx.supabase
        .from("goals")
        .select("id, target_type, target_value, updated_at")
        .order("target_type", { ascending: true });

      if (error) {
        return serverError(error);
      }
      return Response.json(data, { status: 200 });
    }

    return Response.json({ error: "method not allowed" }, { status: 405 });
  }),
};
