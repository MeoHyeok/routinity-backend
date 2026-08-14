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

test("buildDailyTemplateReport: appends a pattern section when insights are given", () => {
  const report = buildDailyTemplateReport(
    [{ target_type: "wake_time", target_value: "07:00", actual_value: "06:50", status: "achieved" as const }],
    100,
    {
      weekday_averages: [],
      best_weekday: { weekday: 1, label: "월", avg_daily_score: 90 },
      worst_weekday: { weekday: 6, label: "토", avg_daily_score: 20 },
      trend: { direction: "up", recent_avg: 70, previous_avg: 55 },
    },
  );
  assert.match(report, /패턴 분석/);
  assert.match(report, /월요일/);
});

test("buildDailyTemplateReport: omits the pattern section when insights are null", () => {
  const report = buildDailyTemplateReport(
    [{ target_type: "wake_time", target_value: "07:00", actual_value: "06:50", status: "achieved" as const }],
    100,
    null,
  );
  assert.doesNotMatch(report, /패턴 분석/);
});
