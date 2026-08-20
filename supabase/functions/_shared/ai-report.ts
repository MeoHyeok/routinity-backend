import { KST_OFFSET_MS, kstDateOf } from "./day-sessions.ts";

// Experimental: swapped from Anthropic Claude to Gemini to try Google AI
// Studio's free tier for the hackathon. Exported so each report endpoint's
// `generated_via` reports the real model that produced the content instead
// of a hardcoded "claude" — see git history to roll back to Anthropic.
export const GEMINI_MODEL = "gemini-3.6-flash";

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
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      },
    );

    if (!res.ok) return null;

    const data = await res.json();
    const candidate = data.candidates?.[0];
    // "SAFETY"/"RECITATION"/etc. are Gemini's refusal-shaped finish reasons —
    // same rationale as the old stop_reason === "refusal" check.
    if (!candidate || candidate.finishReason !== "STOP") return null;

    const text = (candidate.content?.parts ?? [])
      .map((p: { text?: string }) => p.text)
      .filter((t: unknown): t is string => typeof t === "string")
      .join("");

    // An empty/whitespace-only response is treated the same as a failure —
    // callers use `content ?? templateFallback()`, which only substitutes on
    // null/undefined, not on "". Without this, a blank response would ship
    // (and cache) an empty report while still reporting generated_via
    // inconsistently depending on how each caller checks for failure.
    return text.trim().length > 0 ? text : null;
  } catch {
    return null;
  }
}
