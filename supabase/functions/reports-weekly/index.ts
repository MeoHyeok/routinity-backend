import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { computeScores, type Goal, type RoutineLog } from "../_shared/scoring.ts";
import {
  buildClaudePrompt,
  buildTemplateReport,
  summarizeWeek,
  type DailyScores,
} from "../_shared/weekly-report.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";

const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayRange(date: string): { start: string; end: string } {
  const start = `${date}T00:00:00.000Z`;
  const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

async function generateWithClaude(prompt: string): Promise<string | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (data.type === "error" || data.stop_reason === "refusal") return null;

    const textBlock = (data.content ?? []).find(
      (b: { type: string }) => b.type === "text",
    );
    return typeof textBlock?.text === "string" ? textBlock.text : null;
  } catch {
    return null;
  }
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "GET") {
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }

    const userId = ctx.userClaims!.id;

    const rateLimited = await enforceRateLimit(ctx.supabase, userId, "reports-weekly", 10, 60);
    if (rateLimited) return rateLimited;

    const today = dateOnly(new Date());
    const { start: todayStart, end: todayEnd } = dayRange(today);

    const cached = await ctx.supabase
      .from("ai_reports")
      .select("content, created_at")
      .eq("period", "weekly")
      .gte("created_at", todayStart)
      .lt("created_at", todayEnd)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached.error) {
      return Response.json({ error: cached.error.message }, { status: 500 });
    }
    if (cached.data) {
      return Response.json(
        { period: "weekly", content: cached.data.content, cached: true },
        { status: 200 },
      );
    }

    const dateList: string[] = [];
    for (let i = 6; i >= 0; i--) {
      dateList.push(
        dateOnly(new Date(new Date(todayStart).getTime() - i * 24 * 60 * 60 * 1000)),
      );
    }
    const weekStart = dayRange(dateList[0]).start;
    const weekEnd = todayEnd;

    const [goalsResult, logsResult] = await Promise.all([
      ctx.supabase.from("goals").select("target_type, target_value"),
      ctx.supabase
        .from("routine_logs")
        .select("type, timestamp")
        .gte("timestamp", weekStart)
        .lt("timestamp", weekEnd),
    ]);

    if (goalsResult.error) {
      return Response.json({ error: goalsResult.error.message }, { status: 500 });
    }
    if (logsResult.error) {
      return Response.json({ error: logsResult.error.message }, { status: 500 });
    }

    const goals: Goal[] = goalsResult.data ?? [];
    const allLogs: RoutineLog[] = logsResult.data ?? [];

    const dailyScores: DailyScores[] = dateList.map((date) => {
      const { start, end } = dayRange(date);
      const dayLogs = allLogs.filter(
        (log) => log.timestamp >= start && log.timestamp < end,
      );
      return { date, scores: computeScores(goals, dayLogs) };
    });

    const stats = summarizeWeek(dailyScores);
    const claudeText = await generateWithClaude(buildClaudePrompt(stats));
    const content = claudeText ?? buildTemplateReport(stats);
    const generatedVia = claudeText ? "claude" : "template";

    const insert = await ctx.supabaseAdmin
      .from("ai_reports")
      .insert({ user_id: userId, period: "weekly", content })
      .select("content")
      .single();

    if (insert.error) {
      return Response.json({ error: insert.error.message }, { status: 500 });
    }

    return Response.json(
      { period: "weekly", content: insert.data.content, cached: false, generated_via: generatedVia },
      { status: 200 },
    );
  }),
};
