import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveDailySuggestedAction, deriveWindowSuggestedAction } from "./suggested-action.ts";

test("deriveDailySuggestedAction: no scores returns null", () => {
  assert.equal(deriveDailySuggestedAction([]), null);
});

test("deriveDailySuggestedAction: everything achieved returns null", () => {
  const action = deriveDailySuggestedAction([
    { target_type: "wake_time", target_value: "07:00", actual_value: "06:50", status: "achieved" as const },
  ]);
  assert.equal(action, null);
});

test("deriveDailySuggestedAction: picks the worst-scoring goal and names its gap", () => {
  const action = deriveDailySuggestedAction([
    { target_type: "wake_time", target_value: "07:00", actual_value: "06:55", status: "achieved" as const },
    { target_type: "study_duration", target_value: "120", actual_value: "30", status: "not_achieved" as const },
  ]);
  assert.match(action!, /90분 부족/);
  assert.match(action!, /120분/);
});

test("deriveDailySuggestedAction: a missing study_duration goal is worded as 'no log', not a computed gap", () => {
  const action = deriveDailySuggestedAction([
    { target_type: "study_duration", target_value: "60", actual_value: null, status: "missing" as const },
  ]);
  assert.match(action!, /기록이 없었어요/);
  assert.doesNotMatch(action!, /분 부족/);
});

test("deriveDailySuggestedAction: a missing goal outranks a partially-met one", () => {
  const action = deriveDailySuggestedAction([
    { target_type: "study_duration", target_value: "60", actual_value: "50", status: "not_achieved" as const },
    { target_type: "wake_time", target_value: "07:00", actual_value: null, status: "missing" as const },
  ]);
  assert.match(action!, /알람/);
});

test("deriveWindowSuggestedAction: no scored goals returns null", () => {
  assert.equal(deriveWindowSuggestedAction([]), null);
});

test("deriveWindowSuggestedAction: perfect achievement across all goals returns null", () => {
  const action = deriveWindowSuggestedAction([
    { target_type: "wake_time", target_value: "07:00", achieved: 7, not_achieved: 0, missing: 0 },
  ]);
  assert.equal(action, null);
});

test("deriveWindowSuggestedAction: picks the goal with the lowest achieved ratio", () => {
  const action = deriveWindowSuggestedAction([
    { target_type: "wake_time", target_value: "07:00", achieved: 6, not_achieved: 1, missing: 0 },
    { target_type: "study_duration", target_value: "60", achieved: 1, not_achieved: 5, missing: 1 },
  ]);
  assert.match(action!, /공부/);
});
