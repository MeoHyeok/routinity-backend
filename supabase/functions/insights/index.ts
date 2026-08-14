import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { loadInsights } from "../_shared/insights.ts";
import { dateOnly, dayRange } from "../_shared/ai-report.ts";
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
    const { start: todayStart } = dayRange(today);
    const windowFrom = dateOnly(new Date(new Date(todayStart).getTime() - (WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000));

    const { data: insights, error } = await loadInsights(ctx.supabase, today);
    if (error) {
      return log(serverError(error));
    }

    return log(Response.json(
      {
        date_range: { from: windowFrom, to: today },
        ...insights,
      },
      { status: 200 },
    ));
  }),
};
