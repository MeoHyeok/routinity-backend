import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDaySessions, kstDateOf, resolveTodaySession, sessionsByDate } from "./day-sessions.ts";
import type { RoutineLog } from "./scoring.ts";

function log(type: string, timestamp: string): RoutineLog {
  return { type, timestamp };
}

test("kstDateOf: an early-morning KST instant (before UTC midnight rolls over) still labels as the KST day it's in", () => {
  // 07:00 KST on 2026-08-18 = 22:00 UTC on 2026-08-17
  assert.equal(kstDateOf("2026-08-17T22:00:00.000Z"), "2026-08-18");
});

test("computeDaySessions: a normal same-UTC-day wake-to-sleep session", () => {
  const logs = [
    log("wake", "2026-08-18T00:00:00.000Z"), // 09:00 KST
    log("meal_start", "2026-08-18T03:00:00.000Z"),
    log("meal_end", "2026-08-18T03:30:00.000Z"),
    log("sleep", "2026-08-18T13:00:00.000Z"), // 22:00 KST
  ];
  const sessions = computeDaySessions(logs);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].date, "2026-08-18");
  assert.equal(sessions[0].closed, true);
  assert.equal(sessions[0].logs.length, 4);
});

test("computeDaySessions: an early-KST-morning wake (would land in the previous UTC day) still forms its own session labeled by KST date", () => {
  // wake at 07:00 KST on 08-18 = 22:00 UTC on 08-17
  const logs = [
    log("wake", "2026-08-17T22:00:00.000Z"),
    log("study_start", "2026-08-17T23:00:00.000Z"),
    log("study_end", "2026-08-18T00:00:00.000Z"),
    log("sleep", "2026-08-18T13:00:00.000Z"),
  ];
  const sessions = computeDaySessions(logs);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].date, "2026-08-18");
  assert.equal(sessions[0].logs.length, 4);
});

test("computeDaySessions: a sleep logged after local midnight still closes the same session as the prior day's wake", () => {
  // wake 07:00 KST on 08-18, sleep 01:00 KST on 08-19 (crosses midnight)
  const logs = [
    log("wake", "2026-08-17T22:00:00.000Z"), // 07:00 KST 08-18
    log("sleep", "2026-08-18T16:00:00.000Z"), // 01:00 KST 08-19
  ];
  const sessions = computeDaySessions(logs);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].date, "2026-08-18");
  assert.equal(sessions[0].closed, true);
});

test("computeDaySessions: a duplicate wake while a session is open is folded into the current session, not a new one", () => {
  const logs = [
    log("wake", "2026-08-18T00:00:00.000Z"),
    log("wake", "2026-08-18T01:00:00.000Z"), // accidental double-tap
    log("sleep", "2026-08-18T13:00:00.000Z"),
  ];
  const sessions = computeDaySessions(logs);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].logs.length, 3);
});

test("computeDaySessions: today's session with no sleep log yet is open, not dropped", () => {
  const logs = [log("wake", "2026-08-18T00:00:00.000Z")];
  const nowMs = new Date("2026-08-18T05:00:00.000Z").getTime(); // 5h after wake
  const sessions = computeDaySessions(logs, nowMs);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].closed, false);
  assert.equal(sessions[0].autoClosed, false);
});

test("computeDaySessions: a still-open session past MAX_SESSION_MS with no sleep ever logged is autoClosed", () => {
  const logs = [
    log("wake", "2026-08-18T00:00:00.000Z"),
    log("meal_start", "2026-08-18T01:00:00.000Z"),
    log("meal_end", "2026-08-18T01:30:00.000Z"),
  ];
  const nowMs = new Date("2026-08-19T01:00:00.000Z").getTime(); // 25h after wake
  const sessions = computeDaySessions(logs, nowMs);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].closed, false); // still no real sleep log
  assert.equal(sessions[0].autoClosed, true);
  assert.equal(sessions[0].logs.length, 3); // autoClosed doesn't synthesize or drop any logs
});

test("computeDaySessions: autoClosed is exactly the MAX_SESSION_MS boundary, not a moment earlier", () => {
  const logs = [log("wake", "2026-08-18T00:00:00.000Z")];
  const exactlyAtBoundary = new Date("2026-08-19T00:00:00.000Z").getTime(); // exactly 24h
  const justPast = new Date("2026-08-19T00:00:00.001Z").getTime();
  assert.equal(computeDaySessions(logs, exactlyAtBoundary)[0].autoClosed, false);
  assert.equal(computeDaySessions(logs, justPast)[0].autoClosed, true);
});

test("computeDaySessions: a session already closed by a real sleep log is never autoClosed", () => {
  const logs = [log("wake", "2026-08-18T00:00:00.000Z"), log("sleep", "2026-08-18T13:00:00.000Z")];
  const nowMs = new Date("2026-09-01T00:00:00.000Z").getTime(); // long after, irrelevant once really closed
  const sessions = computeDaySessions(logs, nowMs);
  assert.equal(sessions[0].closed, true);
  assert.equal(sessions[0].autoClosed, false);
});

test("computeDaySessions: a log before any wake has ever occurred is orphaned and dropped", () => {
  const logs = [
    log("meal_start", "2026-08-18T00:00:00.000Z"),
    log("meal_end", "2026-08-18T00:30:00.000Z"),
  ];
  const sessions = computeDaySessions(logs);
  assert.equal(sessions.length, 0);
});

test("computeDaySessions: two separate days each get their own session", () => {
  const logs = [
    log("wake", "2026-08-17T22:00:00.000Z"), // 08-18 07:00 KST
    log("sleep", "2026-08-18T12:00:00.000Z"), // 08-18 21:00 KST
    log("wake", "2026-08-18T22:00:00.000Z"), // 08-19 07:00 KST
    log("sleep", "2026-08-19T12:00:00.000Z"), // 08-19 21:00 KST
  ];
  const sessions = computeDaySessions(logs);
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map((s) => s.date), ["2026-08-18", "2026-08-19"]);
});

test("sessionsByDate: looks up a session by its KST date label", () => {
  const logs = [log("wake", "2026-08-17T22:00:00.000Z"), log("sleep", "2026-08-18T12:00:00.000Z")];
  const map = sessionsByDate(computeDaySessions(logs));
  assert.equal(map.get("2026-08-18")?.closed, true);
  assert.equal(map.get("2026-08-19"), undefined);
});

test("computeDaySessions: a wake more than 24h after the one that opened the current session starts a fresh session instead of folding in", () => {
  const logs = [
    log("wake", "2026-08-17T22:00:00.000Z"), // 08-18 07:00 KST — never sleeps
    log("study_start", "2026-08-18T00:00:00.000Z"),
    log("study_end", "2026-08-18T01:00:00.000Z"),
    log("wake", "2026-08-19T22:30:00.000Z"), // 08-20 07:30 KST — > 24h after the first wake
    log("sleep", "2026-08-20T12:00:00.000Z"),
  ];
  const sessions = computeDaySessions(logs);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].date, "2026-08-18");
  assert.equal(sessions[0].closed, false);
  assert.equal(sessions[0].logs.length, 3); // wake + the study pair, not the later wake/sleep
  assert.equal(sessions[1].date, "2026-08-20");
  assert.equal(sessions[1].closed, true);
});

test("computeDaySessions: a wake within 24h still folds into the open session even without a sleep in between", () => {
  const logs = [
    log("wake", "2026-08-18T00:00:00.000Z"),
    log("wake", "2026-08-18T20:00:00.000Z"), // 20h later — a very long day, not a new one
    log("sleep", "2026-08-19T02:00:00.000Z"),
  ];
  const sessions = computeDaySessions(logs);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].logs.length, 3);
});

test("resolveTodaySession: a session that opened and closed today is used directly", () => {
  const logs = [log("wake", "2026-08-17T22:00:00.000Z"), log("sleep", "2026-08-18T09:00:00.000Z")];
  const sessions = computeDaySessions(logs);
  const todayStartMs = new Date("2026-08-17T15:00:00.000Z").getTime(); // 00:00 KST 08-18
  const resolved = resolveTodaySession(sessions, "2026-08-18", todayStartMs);
  assert.equal(resolved?.date, "2026-08-18");
});

test("resolveTodaySession: falls back to yesterday's session when its sleep log spilled past today's KST midnight", () => {
  // wake 08:00 KST 08-18, sleep 00:30 KST 08-19 — the documented
  // sleep-log-triggers-report client flow calling right after that sleep.
  const logs = [
    log("wake", "2026-08-17T23:00:00.000Z"), // 08:00 KST 08-18
    log("sleep", "2026-08-18T15:30:00.000Z"), // 00:30 KST 08-19
  ];
  const sessions = computeDaySessions(logs);
  const todayStartMs = new Date("2026-08-18T15:00:00.000Z").getTime(); // 00:00 KST 08-19
  const resolved = resolveTodaySession(sessions, "2026-08-19", todayStartMs);
  assert.equal(resolved?.date, "2026-08-18");
  assert.equal(resolved?.session.closed, true);
});

test("resolveTodaySession: does not fall back to yesterday's session if it closed before today's KST midnight", () => {
  // wake 07:00 KST 08-18, sleep 23:00 KST 08-18 (same day, no spillover) —
  // checking at 15:00 KST 08-19 with nothing logged yet today.
  const logs = [
    log("wake", "2026-08-17T22:00:00.000Z"), // 07:00 KST 08-18
    log("sleep", "2026-08-18T14:00:00.000Z"), // 23:00 KST 08-18
  ];
  const sessions = computeDaySessions(logs);
  const todayStartMs = new Date("2026-08-18T15:00:00.000Z").getTime(); // 00:00 KST 08-19
  const resolved = resolveTodaySession(sessions, "2026-08-19", todayStartMs);
  assert.equal(resolved, null);
});

test("resolveTodaySession: returns null when neither today nor a spilled-over yesterday session exists", () => {
  const resolved = resolveTodaySession([], "2026-08-19", new Date("2026-08-18T15:00:00.000Z").getTime());
  assert.equal(resolved, null);
});
