import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTemplateReport, summarizeWeek } from "./weekly-report.ts";

test("summarizeWeek: aggregates status counts per target_type across days", () => {
  const days = [
    {
      date: "2026-08-04",
      scores: [
        { target_type: "wake_time", target_value: "07:00", actual_value: "06:50", status: "achieved" as const },
        { target_type: "study_duration", target_value: "60", actual_value: "30", status: "not_achieved" as const },
      ],
    },
    {
      date: "2026-08-05",
      scores: [
        { target_type: "wake_time", target_value: "07:00", actual_value: null, status: "missing" as const },
        { target_type: "study_duration", target_value: "60", actual_value: "90", status: "achieved" as const },
      ],
    },
  ];

  const stats = summarizeWeek(days);
  const wake = stats.find((s) => s.target_type === "wake_time")!;
  const study = stats.find((s) => s.target_type === "study_duration")!;

  assert.deepEqual(wake, {
    target_type: "wake_time",
    target_value: "07:00",
    achieved: 1,
    not_achieved: 0,
    missing: 1,
  });
  assert.deepEqual(study, {
    target_type: "study_duration",
    target_value: "60",
    achieved: 1,
    not_achieved: 1,
    missing: 0,
  });
});

test("summarizeWeek: no goals over the week produces an empty stats list", () => {
  const days = [
    { date: "2026-08-04", scores: [] },
    { date: "2026-08-05", scores: [] },
  ];
  assert.deepEqual(summarizeWeek(days), []);
});

test("buildTemplateReport: renders counts per goal with Korean labels", () => {
  const report = buildTemplateReport([
    { target_type: "wake_time", target_value: "07:00", achieved: 5, not_achieved: 1, missing: 1 },
  ]);
  assert.match(report, /기상 목표/);
  assert.match(report, /5일 달성/);
  assert.match(report, /1일 미달/);
  assert.match(report, /1일 기록 없음/);
});

test("buildTemplateReport: no stats returns the no-goals message", () => {
  const report = buildTemplateReport([]);
  assert.match(report, /목표가 없어/);
});

test("buildTemplateReport: appends a pattern section when insights are given", () => {
  const report = buildTemplateReport(
    [{ target_type: "wake_time", target_value: "07:00", achieved: 5, not_achieved: 1, missing: 1 }],
    {
      weekday_averages: [],
      best_weekday: { weekday: 1, label: "월", avg_daily_score: 90 },
      worst_weekday: { weekday: 6, label: "토", avg_daily_score: 20 },
      trend: null,
    },
  );
  assert.match(report, /패턴 분석/);
  assert.match(report, /월요일/);
});

test("buildTemplateReport: omits the pattern section when insights are null", () => {
  const report = buildTemplateReport([
    { target_type: "wake_time", target_value: "07:00", achieved: 5, not_achieved: 1, missing: 1 },
  ]);
  assert.doesNotMatch(report, /패턴 분석/);
});
