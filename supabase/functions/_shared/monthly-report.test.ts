import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMonthlyClaudePrompt, buildMonthlyTemplateReport } from "./monthly-report.ts";

test("buildMonthlyTemplateReport: no stats and no breakdown returns the no-data message", () => {
  const report = buildMonthlyTemplateReport([]);
  assert.match(report, /목표나 기록이 없어/);
});

test("buildMonthlyTemplateReport: no goals but raw activity (no wake+sleep pair) still produces a report", () => {
  const report = buildMonthlyTemplateReport([], null, null, { daysCounted: 10, wakeLoggedDays: 3, avgStudyMinutes: 40, avgMealMinutes: 0 });
  assert.doesNotMatch(report, /기록이 없어/);
  assert.match(report, /활동 기록 요약/);
  assert.match(report, /목표를 설정하면/);
});

test("buildMonthlyTemplateReport: an average breakdown alone (no goals) still produces a report", () => {
  const report = buildMonthlyTemplateReport([], null, {
    daysCounted: 20,
    avgAwakeMinutes: 900,
    avgMealMinutes: 80,
    avgStudyMinutes: 45,
    avgRestMinutes: 775,
  });
  assert.doesNotMatch(report, /기록이 없어/);
  assert.match(report, /일평균 시간 분배/);
});

test("buildMonthlyTemplateReport: renders counts over a 30-day window with Korean labels", () => {
  const report = buildMonthlyTemplateReport([
    { target_type: "wake_time", target_value: "07:00", achieved: 20, not_achieved: 5, missing: 5 },
  ]);
  assert.match(report, /기상 목표/);
  assert.match(report, /최근 30일 중/);
  assert.match(report, /20일 달성/);
  assert.match(report, /5일 미달/);
  assert.match(report, /5일 기록 없음/);
});

test("buildMonthlyTemplateReport: the '중' total is the goal's own scored-day count, not the window size", () => {
  // A goal set partway through the 30-day window is only scored from then
  // on (goalsExistingBy) — the total here (12) is less than the full window.
  const report = buildMonthlyTemplateReport([
    { target_type: "wake_time", target_value: "07:00", achieved: 8, not_achieved: 2, missing: 2 },
  ]);
  assert.match(report, /최근 12일 중/);
  assert.doesNotMatch(report, /최근 30일 중/);
});

test("buildMonthlyTemplateReport: appends a pattern section when insights are given", () => {
  const report = buildMonthlyTemplateReport(
    [{ target_type: "wake_time", target_value: "07:00", achieved: 20, not_achieved: 5, missing: 5 }],
    {
      weekday_averages: [],
      best_weekday: { weekday: 1, label: "월", avg_daily_score: 90 },
      worst_weekday: { weekday: 6, label: "토", avg_daily_score: 20 },
      trend: null,
      current_streak_days: 0,
    },
  );
  assert.match(report, /패턴 분석/);
  assert.match(report, /월요일/);
});

test("buildMonthlyClaudePrompt: includes the 30-day window and per-goal lines", () => {
  const prompt = buildMonthlyClaudePrompt([
    { target_type: "study_duration", target_value: "60", achieved: 10, not_achieved: 10, missing: 10 },
  ]);
  assert.match(prompt, /한 달\(30일\)/);
  assert.match(prompt, /공부 시간 목표/);
  assert.match(prompt, /최근 30일 기준/);
  assert.match(prompt, /ACTION:/);
});
