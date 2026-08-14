import { test } from "node:test";
import assert from "node:assert/strict";
import { requestLogger } from "./log.ts";

test("requestLogger: returns the same response unchanged", () => {
  const log = requestLogger("logs", "GET");
  const response = Response.json({ ok: true }, { status: 200 });
  assert.equal(log(response), response);
});

test("requestLogger: writes one structured log line with endpoint, method, status, and latency", () => {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (line: string) => lines.push(line);
  try {
    const log = requestLogger("goals", "POST");
    log(Response.json({}, { status: 429 }));
  } finally {
    console.log = originalLog;
  }

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.endpoint, "goals");
  assert.equal(parsed.method, "POST");
  assert.equal(parsed.status, 429);
  assert.equal(typeof parsed.ms, "number");
});
