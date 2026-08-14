import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDailyClaudePrompt, buildDailyTemplateReport } from "./daily-report.ts";

test("buildDailyTemplateReport: no scores returns the no-goals message", () => {
  const report = buildDailyTemplateReport([], null);
  assert.match(report, /목표가 없어/);
});

test("buildDailyTemplateReport: renders the daily score and per-goal status with Korean labels", () => {
  const report = buildDailyTemplateReport(
    [
      { target_type: "wake_time", target_value: "07:00", actual_value: "07:30", status: "not_achieved" as const },
      { target_type: "study_duration", target_value: "60", actual_value: null, status: "missing" as const },
    ],
    58,
  );
  assert.match(report, /58점/);
  assert.match(report, /기상 목표/);
  assert.match(report, /미달성/);
  assert.match(report, /공부 시간 목표/);
  assert.match(report, /기록 없음/);
});

test("buildDailyClaudePrompt: includes the daily score and per-goal lines", () => {
  const prompt = buildDailyClaudePrompt(
    [{ target_type: "wake_time", target_value: "07:00", actual_value: "06:50", status: "achieved" as const }],
    100,
  );
  assert.match(prompt, /100점/);
  assert.match(prompt, /기상 목표/);
  assert.match(prompt, /달성/);
});
