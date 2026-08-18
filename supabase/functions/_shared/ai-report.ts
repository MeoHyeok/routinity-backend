import { kstDateOf } from "./day-sessions.ts";

const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// KST calendar date, not UTC — a UTC calendar day runs 09:00 KST to 09:00
// KST the next day, which would misattribute a Korean user's early-morning
// activity (and the "already generated today" cache check) to the previous
// day. See day-sessions.ts for the log-bucketing counterpart of this fix.
export function dateOnly(d: Date): string {
  return kstDateOf(d);
}

// [start, end) in UTC instants spanning one KST calendar day (`date`,
// 00:00-24:00 KST). Used for the ai_reports "once per day" cache window —
// actual log-to-day attribution goes through day-sessions.ts's
// wake-to-sleep sessions, not this fixed clock boundary.
export function dayRange(date: string): { start: string; end: string } {
  const start = new Date(new Date(`${date}T00:00:00.000Z`).getTime() - KST_OFFSET_MS).toISOString();
  const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

// Claude prompts (see daily/weekly/monthly-report.ts) are instructed to end
// their response with a lone "ACTION: ..." line so the one-sentence
// suggestion can be pulled out as its own field instead of staying buried
// in free text (that separation is the whole point per the iOS request).
// If Claude doesn't follow the format, suggestedAction is null and the
// caller falls back to the rule-based deriveDailySuggestedAction /
// deriveWindowSuggestedAction.
export function extractSuggestedAction(text: string): { content: string; suggestedAction: string | null } {
  const trimmed = text.trimEnd();
  const lines = trimmed.split("\n");
  const lastLine = lines[lines.length - 1];
  const match = lastLine.match(/^ACTION:\s*(.+)$/i);
  if (!match) return { content: trimmed, suggestedAction: null };
  return { content: lines.slice(0, -1).join("\n").trimEnd(), suggestedAction: match[1].trim() };
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
    if (typeof textBlock?.text !== "string") return null;
    // An empty/whitespace-only response is treated the same as a failure —
    // callers use `content ?? templateFallback()`, which only substitutes on
    // null/undefined, not on "". Without this, a blank Claude response would
    // ship (and cache) an empty report while still reporting generated_via
    // inconsistently depending on how each caller checks for failure.
    return textBlock.text.trim().length > 0 ? textBlock.text : null;
  } catch {
    return null;
  }
}
