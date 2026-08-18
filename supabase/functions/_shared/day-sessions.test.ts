import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDaySessions, kstDateOf, sessionsByDate } from "./day-sessions.ts";
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
  const sessions = computeDaySessions(logs);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].closed, false);
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
