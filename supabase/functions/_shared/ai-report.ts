const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

export function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dayRange(date: string): { start: string; end: string } {
  const start = `${date}T00:00:00.000Z`;
  const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

// DB timestamps (Postgres "+00:00" suffix, variable fractional-second digits)
// and constructed range boundaries (always ".000Z") don't share a string
// format, so comparing them as raw strings can misorder values that are
// exactly equal instants (see the reports-weekly midnight-boundary fix) —
// always compare parsed epoch ms instead.
export function filterLogsInRange<T extends { timestamp: string }>(
  logs: T[],
  start: string,
  end: string,
): T[] {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  return logs.filter((log) => {
    const t = new Date(log.timestamp).getTime();
    return t >= startMs && t < endMs;
  });
}

export async function generateWithClaude(prompt: string): Promise<string | null> {
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
