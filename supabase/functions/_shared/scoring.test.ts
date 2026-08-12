import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScores } from "./scoring.ts";

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
