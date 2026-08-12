import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRateLimit } from "./rate-limit.ts";

test("evaluateRateLimit: db error becomes a 500 decision with a generic message (no internal detail leak)", () => {
  const decision = evaluateRateLimit({ data: null, error: { message: "boom" } });
  assert.deepEqual(decision, { status: 500, body: { error: "internal server error" } });
});

test("evaluateRateLimit: data false becomes a 429 decision", () => {
  const decision = evaluateRateLimit({ data: false, error: null });
  assert.equal(decision?.status, 429);
});

test("evaluateRateLimit: data true means no decision (request proceeds)", () => {
  const decision = evaluateRateLimit({ data: true, error: null });
  assert.equal(decision, null);
});
