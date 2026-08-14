import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDailyScore, computeScores } from "./scoring.ts";

test("wake_time: achieved when actual wake time is at or before target", () => {
  const goals = [{ target_type: "wake_time", target_value: "07:00" }];
  const logs = [{ type: "wake", timestamp: "2026-08-10T06:50:00Z" }];
  const [score] = computeScores(goals, logs);
  assert.equal(score.status, "achieved");
  assert.equal(score.actual_value, "06:50");
});

test("wake_time: not_achieved when actual wake time is after target", () => {
  const goals = [{ target_type: "wake_time", target_value: "07:00" }];
  const logs = [{ type: "wake", timestamp: "2026-08-10T07:30:00Z" }];
  const [score] = computeScores(goals, logs);
  assert.equal(score.status, "not_achieved");
  assert.equal(score.actual_value, "07:30");
});

test("wake_time: missing when there is no wake log for the day", () => {
  const goals = [{ target_type: "wake_time", target_value: "07:00" }];
  const [score] = computeScores(goals, []);
  assert.equal(score.status, "missing");
  assert.equal(score.actual_value, null);
});

test("study_duration: achieved when total study time meets target", () => {
  const goals = [{ target_type: "study_duration", target_value: "60" }];
  const logs = [
    { type: "study_start", timestamp: "2026-08-10T09:00:00Z" },
    { type: "study_end", timestamp: "2026-08-10T10:00:00Z" },
  ];
  const [score] = computeScores(goals, logs);
  assert.equal(score.status, "achieved");
  assert.equal(score.actual_value, "60");
});

test("study_duration: not_achieved when total study time falls short, summing multiple sessions", () => {
  const goals = [{ target_type: "study_duration", target_value: "60" }];
  const logs = [
    { type: "study_start", timestamp: "2026-08-10T09:00:00Z" },
    { type: "study_end", timestamp: "2026-08-10T09:20:00Z" },
    { type: "study_start", timestamp: "2026-08-10T14:00:00Z" },
    { type: "study_end", timestamp: "2026-08-10T14:10:00Z" },
  ];
  const [score] = computeScores(goals, logs);
  assert.equal(score.status, "not_achieved");
  assert.equal(score.actual_value, "30");
});

test("study_duration: missing when there are no study logs for the day", () => {
  const goals = [{ target_type: "study_duration", target_value: "60" }];
  const [score] = computeScores(goals, []);
  assert.equal(score.status, "missing");
  assert.equal(score.actual_value, null);
});

test("computeScores: multiple goals scored independently, unsupported target_type filtered out", () => {
  const goals = [
    { target_type: "wake_time", target_value: "07:00" },
    { target_type: "study_duration", target_value: "60" },
    { target_type: "future_goal_type", target_value: "whatever" },
  ];
  const logs = [
    { type: "wake", timestamp: "2026-08-10T06:00:00Z" },
    { type: "study_start", timestamp: "2026-08-10T09:00:00Z" },
    { type: "study_end", timestamp: "2026-08-10T09:45:00Z" },
  ];
  const scores = computeScores(goals, logs);
  assert.equal(scores.length, 2);
  assert.deepEqual(
    scores.map((s) => s.target_type).sort(),
    ["study_duration", "wake_time"],
  );
});

test("wake_time: earliest wake log wins regardless of input order (DB row order isn't guaranteed)", () => {
  const goals = [{ target_type: "wake_time", target_value: "07:00" }];
  const logs = [
    { type: "wake", timestamp: "2026-08-10T07:20:00Z" },
    { type: "wake", timestamp: "2026-08-10T06:40:00Z" },
  ];
  const [score] = computeScores(goals, logs);
  assert.equal(score.actual_value, "06:40");
  assert.equal(score.status, "achieved");
});

test("study_duration: an unmatched trailing study_start is not counted", () => {
  const goals = [{ target_type: "study_duration", target_value: "10" }];
  const logs = [
    { type: "study_start", timestamp: "2026-08-10T09:00:00Z" },
    { type: "study_end", timestamp: "2026-08-10T09:15:00Z" },
    { type: "study_start", timestamp: "2026-08-10T20:00:00Z" },
  ];
  const [score] = computeScores(goals, logs);
  assert.equal(score.actual_value, "15");
  assert.equal(score.status, "achieved");
});

test("computeDailyScore: no scorable goals returns null", () => {
  assert.equal(computeDailyScore([]), null);
});

test("computeDailyScore: all achieved is 100", () => {
  const scores = [
    { target_type: "wake_time", target_value: "07:00", actual_value: "06:50", status: "achieved" as const },
    { target_type: "study_duration", target_value: "60", actual_value: "60", status: "achieved" as const },
  ];
  assert.equal(computeDailyScore(scores), 100);
});

test("computeDailyScore: missing always contributes zero credit (no data to judge closeness)", () => {
  const scores = [
    { target_type: "wake_time", target_value: "07:00", actual_value: null, status: "missing" as const },
  ];
  assert.equal(computeDailyScore(scores), 0);
});

test("computeDailyScore: rounds to nearest integer", () => {
  const scores = [
    { target_type: "a", target_value: "1", actual_value: "1", status: "achieved" as const },
    { target_type: "b", target_value: "1", actual_value: null, status: "missing" as const },
    { target_type: "c", target_value: "1", actual_value: null, status: "missing" as const },
  ];
  assert.equal(computeDailyScore(scores), 33);
});

test("computeDailyScore: study_duration not_achieved earns proportional partial credit", () => {
  const scores = [
    { target_type: "study_duration", target_value: "60", actual_value: "30", status: "not_achieved" as const },
  ];
  assert.equal(computeDailyScore(scores), 50);
});

test("computeDailyScore: wake_time not_achieved credit decays with how late it was", () => {
  const scores = [
    { target_type: "wake_time", target_value: "07:00", actual_value: "07:30", status: "not_achieved" as const },
  ];
  // 30 min late out of a 120 min grace window -> 75% credit
  assert.equal(computeDailyScore(scores), 75);
});

test("computeDailyScore: wake_time credit floors at 0 once past the grace window", () => {
  const scores = [
    { target_type: "wake_time", target_value: "07:00", actual_value: "10:00", status: "not_achieved" as const },
  ];
  // 180 min late > 120 min grace window
  assert.equal(computeDailyScore(scores), 0);
});

test("computeDailyScore: mixed achieved + partial credit rounds a fractional average", () => {
  const scores = [
    { target_type: "wake_time", target_value: "07:00", actual_value: "06:50", status: "achieved" as const },
    { target_type: "study_duration", target_value: "60", actual_value: "25", status: "not_achieved" as const },
  ];
  // (1 + 25/60) / 2 * 100 = 70.8333... -> 71
  assert.equal(computeDailyScore(scores), 71);
});
