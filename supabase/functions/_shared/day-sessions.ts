import type { RoutineLog } from "./scoring.ts";

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// The KST (UTC+9) calendar date an instant falls on. Used instead of a raw
// UTC date everywhere "today"/"this day" means something to a Korean user —
// a UTC calendar day runs 09:00 KST to 09:00 KST the next day, so anything
// UTC-anchored silently misattributes any activity before 9am KST to the
// previous day.
export function kstDateOf(timestamp: string | Date): string {
  const ms = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp.getTime();
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export interface DaySession {
  date: string; // YYYY-MM-DD, KST date of the session's opening wake log
  logs: RoutineLog[]; // all logs from that wake (inclusive) to the closing sleep (inclusive), timestamp order
  closed: boolean; // true only once a real `sleep` log has ended the session — unaffected by autoClosed
  autoClosed: boolean; // true if MAX_SESSION_MS elapsed since open with no `sleep` ever logged — see below
}

// Buckets a flat log list into "day sessions" instead of fixed clock
// boundaries (UTC midnight, KST midnight, or any other cutoff hour all have
// the same flaw: a late sleeper's post-cutoff `sleep` log lands on the
// "wrong" day, splitting it from the `wake` that opened it). A session opens
// on a user's first `wake` log after any prior session closed, and stays
// open — collecting every log in between, whatever day they fall on — until
// the next `sleep` log closes it. The session is labeled by the KST calendar
// date of its opening `wake`, which is what the user actually thinks of as
// "that day."
//
// A `wake` logged while a session is already open (double tap, a nap,
// mid-day correction) doesn't start a new session — it's folded into the
// current one, so the earliest-wake tie-break in scoreWakeTime/
// computeDayBreakdown still applies. A log that arrives before any `wake`
// has been seen (nothing open yet) is orphaned and dropped — there's no
// session for it to belong to.
//
// Exception: a `wake` more than MAX_SESSION_MS after the one that opened
// the current session closes that session (unclosed — no sleep was ever
// found for it) and starts a fresh one. Without this, a user who forgets to
// log `sleep` for a day or more would have every subsequent day's logs
// silently folded into one ever-growing session labeled with the first
// day's date — losing those days' wake_time scoring entirely and inflating
// the first day's study/meal totals with everything logged after it.
const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

// Any endpoint that fetches a bounded window of logs and then runs
// computeDaySessions on just that slice must fetch starting at least this
// far *before* its nominal window start, or it can misjudge a wake that
// falls inside the window. Reason: a still-open session can only go on
// absorbing new `wake` logs (instead of splitting into a new session) while
// they land within MAX_SESSION_MS of the session's original open — so any
// wake inside the window that's really a fold into an earlier, out-of-window
// session must have opened within MAX_SESSION_MS before the window start.
// Fetching that far back guarantees the windowed computation agrees with
// what running computeDaySessions over full history would produce. Found
// via a real case: a session opened at 18:47 KST with no `sleep` since, and
// a `wake` at 01:39 KST the next day folded into it — endpoints fetching
// from that day's own midnight (no lookback) never saw the 18:47 open and
// wrongly treated 01:39 as starting a fresh session, while /reports-daily's
// existing one-day lookback (fetching from the *previous* day's midnight)
// happened to see it and got the right answer. See docs/api-contract.md.
export const SESSION_LOOKBACK_MS = MAX_SESSION_MS;

// `nowMs` defaults to the real wall clock for production callers; tests pass
// a fixed value for determinism. It only matters for a session that's still
// open when the log list runs out (every earlier session was already
// finalized by a `sleep` log or a later out-of-window `wake` inside the
// loop): if MAX_SESSION_MS has elapsed since that trailing session opened
// and it's still never gotten a `sleep`, it's marked `autoClosed` — the same
// 24h rule as the in-loop wake-triggered split above, just evaluated against
// wall-clock time instead of waiting for the next `wake` to trigger it.
// Without this, a user who taps `wake` once and never logs `sleep` again
// would have that day sit "open" forever: `daily_score` is unaffected (it
// only reads session.logs, not closed/autoClosed), but the day could never
// be told apart from a normal still-in-progress today, and any UI relying on
// "has this session finished" (e.g. to unlock the next day's wake button)
// would stay blocked indefinitely even though nothing more is coming.
// `time_breakdown` deliberately stays null even once autoClosed — there's
// still no real `sleep` timestamp, and computeDayBreakdown's philosophy
// throughout this codebase is to report "no data" rather than guess one
// (see scoreCredit's "missing always gets 0" doc comment for the same
// principle) rather than fabricate a bedtime the user never logged.
export function computeDaySessions(logs: RoutineLog[], nowMs: number = Date.now()): DaySession[] {
  const sorted = [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const sessions: DaySession[] = [];
  let current: DaySession | null = null;
  let openedAtMs = 0;

  for (const log of sorted) {
    const logMs = new Date(log.timestamp).getTime();
    if (current !== null && log.type === "wake" && logMs - openedAtMs > MAX_SESSION_MS) {
      sessions.push(current);
      current = null;
    }
    if (current === null) {
      if (log.type !== "wake") continue;
      current = { date: kstDateOf(log.timestamp), logs: [], closed: false, autoClosed: false };
      openedAtMs = logMs;
    }
    current.logs.push(log);
    if (log.type === "sleep") {
      current.closed = true;
      sessions.push(current);
      current = null;
    }
  }
  if (current !== null) {
    if (nowMs - openedAtMs > MAX_SESSION_MS) current.autoClosed = true;
    sessions.push(current);
  }

  return sessions;
}

// O(1) lookup by a session's KST date label.
export function sessionsByDate(sessions: DaySession[]): Map<string, DaySession> {
  const map = new Map<string, DaySession>();
  for (const s of sessions) map.set(s.date, s);
  return map;
}

// For /reports-daily's "today" only. Normally "today" is whatever session
// opened with a wake today — but the documented client trigger for this
// endpoint is "call it right after the sleep log succeeds," and a user who
// sleeps past KST midnight has their session labeled *yesterday* (by its
// wake) while the wall clock has already ticked over to today. Without this
// fallback, that request would find no session for today and return an
// empty report at the exact moment the user finishes their day.
//
// Falls back to yesterday's session only when it's closed AND its closing
// sleep log landed after today's KST midnight — i.e. it genuinely spilled
// into today, not a normal same-day session from a full day ago that
// happens to still be the most recent one on file.
export function resolveTodaySession(
  sessions: DaySession[],
  today: string,
  todayStartMs: number,
): { date: string; session: DaySession } | null {
  const map = sessionsByDate(sessions);
  const todaySession = map.get(today);
  if (todaySession) return { date: today, session: todaySession };

  const yesterday = kstDateOf(new Date(todayStartMs - 1));
  const prev = map.get(yesterday);
  if (prev && prev.closed) {
    const closeMs = new Date(prev.logs[prev.logs.length - 1].timestamp).getTime();
    if (closeMs >= todayStartMs) return { date: yesterday, session: prev };
  }

  return null;
}
