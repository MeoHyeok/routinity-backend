import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInsights, describeInsights } from "./insights.ts";

test("computeInsights: no scored days returns empty/null everywhere", () => {
  const result = computeInsights([], "2026-08-14");
  assert.deepEqual(result.weekday_averages, []);
  assert.equal(result.best_weekday, null);
  assert.equal(result.worst_weekday, null);
  assert.equal(result.trend, null);
});

test("computeInsights: null daily_score days are excluded from every aggregate", () => {
  const result = computeInsights(
    [
      { date: "2026-08-14", dailyScore: null },
      { date: "2026-08-13", dailyScore: null },
    ],
    "2026-08-14",
  );
  assert.deepEqual(result.weekday_averages, []);
  assert.equal(result.trend, null);
});

test("computeInsights: averages days onto their UTC weekday", () => {
  // 2026-08-14 is a Friday (weekday 5), 2026-08-07 is also a Friday
  const result = computeInsights(
    [
      { date: "2026-08-14", dailyScore: 80 },
      { date: "2026-08-07", dailyScore: 60 },
    ],
    "2026-08-14",
  );
  assert.equal(result.weekday_averages.length, 1);
  assert.deepEqual(result.weekday_averages[0], {
    weekday: 5,
    label: "금",
    avg_daily_score: 70,
    days_counted: 2,
  });
});

test("computeInsights: identifies the best and worst weekday", () => {
  const result = computeInsights(
    [
      { date: "2026-08-10", dailyScore: 90 }, // Monday
      { date: "2026-08-15", dailyScore: 20 }, // Saturday
      { date: "2026-08-12", dailyScore: 50 }, // Wednesday
    ],
    "2026-08-15",
  );
  assert.deepEqual(result.best_weekday, { weekday: 1, label: "월", avg_daily_score: 90 });
  assert.deepEqual(result.worst_weekday, { weekday: 6, label: "토", avg_daily_score: 20 });
});

test("computeInsights: trend is null when only one of the two 7-day windows has data", () => {
  const result = computeInsights(
    [{ date: "2026-08-14", dailyScore: 80 }], // offset 0, in the "recent" window only
    "2026-08-14",
  );
  assert.equal(result.trend, null);
});

test("computeInsights: trend compares the recent 7 days against the prior 7 days", () => {
  const result = computeInsights(
    [
      { date: "2026-08-14", dailyScore: 80 }, // offset 0 -> recent
      { date: "2026-08-08", dailyScore: 60 }, // offset 6 -> recent
      { date: "2026-08-07", dailyScore: 40 }, // offset 7 -> previous
      { date: "2026-08-01", dailyScore: 20 }, // offset 13 -> previous
    ],
    "2026-08-14",
  );
  assert.deepEqual(result.trend, { direction: "up", recent_avg: 70, previous_avg: 30 });
});

test("computeInsights: a small difference between windows is reported as flat, not up/down", () => {
  const result = computeInsights(
    [
      { date: "2026-08-14", dailyScore: 51 }, // recent
      { date: "2026-08-07", dailyScore: 50 }, // previous
    ],
    "2026-08-14",
  );
  assert.equal(result.trend?.direction, "flat");
});

test("describeInsights: null insights produces no lines", () => {
  assert.deepEqual(describeInsights(null), []);
});

test("describeInsights: empty insights (no scored days) produces no lines", () => {
  assert.deepEqual(
    describeInsights({ weekday_averages: [], best_weekday: null, worst_weekday: null, trend: null, current_streak_days: 0 }),
    [],
  );
});

test("describeInsights: skips the best/worst line when only one weekday has data (best === worst)", () => {
  const lines = describeInsights({
    weekday_averages: [{ weekday: 5, label: "금", avg_daily_score: 80, days_counted: 2 }],
    best_weekday: { weekday: 5, label: "금", avg_daily_score: 80 },
    worst_weekday: { weekday: 5, label: "금", avg_daily_score: 80 },
    trend: null,
    current_streak_days: 0,
  });
  assert.deepEqual(lines, []);
});

test("describeInsights: describes best/worst weekday and an upward trend", () => {
  const lines = describeInsights({
    weekday_averages: [],
    best_weekday: { weekday: 1, label: "월", avg_daily_score: 90 },
    worst_weekday: { weekday: 6, label: "토", avg_daily_score: 20 },
    trend: { direction: "up", recent_avg: 70, previous_avg: 55 },
    current_streak_days: 0,
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /월요일.*토요일/);
  assert.match(lines[1], /올랐어요/);
  assert.match(lines[1], /55점.*70점/);
});

test("describeInsights: describes a flat trend without saying up or down", () => {
  const lines = describeInsights({
    weekday_averages: [],
    best_weekday: null,
    worst_weekday: null,
    trend: { direction: "flat", recent_avg: 51, previous_avg: 50 },
    current_streak_days: 0,
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /유지되고 있어요/);
});

test("describeInsights: mentions the streak once it reaches 2 days", () => {
  const lines = describeInsights({
    weekday_averages: [],
    best_weekday: null,
    worst_weekday: null,
    trend: null,
    current_streak_days: 2,
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /2일 연속/);
});

test("describeInsights: a 1-day streak is not mentioned (not meaningful yet)", () => {
  const lines = describeInsights({
    weekday_averages: [],
    best_weekday: null,
    worst_weekday: null,
    trend: null,
    current_streak_days: 1,
  });
  assert.deepEqual(lines, []);
});

test("computeInsights: streak counts consecutive activity days back from today, stopping at the first gap", () => {
  const result = computeInsights(
    [
      { date: "2026-08-18", dailyScore: null, hasActivity: true },
      { date: "2026-08-19", dailyScore: null, hasActivity: false },
      { date: "2026-08-20", dailyScore: null, hasActivity: true },
      { date: "2026-08-21", dailyScore: null, hasActivity: true },
      { date: "2026-08-22", dailyScore: null, hasActivity: true },
    ],
    "2026-08-22",
  );
  // 08-19 has no activity, so the streak stops there even though 08-18 does.
  assert.equal(result.current_streak_days, 3);
});

test("computeInsights: streak works for a goal-less user (hasActivity true, dailyScore always null)", () => {
  const result = computeInsights(
    [
      { date: "2026-08-20", dailyScore: null, hasActivity: true },
      { date: "2026-08-21", dailyScore: null, hasActivity: true },
    ],
    "2026-08-21",
  );
  assert.equal(result.current_streak_days, 2);
});

test("computeInsights: streak is 0 when today itself has no activity", () => {
  const result = computeInsights([{ date: "2026-08-20", dailyScore: 50, hasActivity: false }], "2026-08-21");
  assert.equal(result.current_streak_days, 0);
});
