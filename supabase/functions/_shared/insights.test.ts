import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInsights } from "./insights.ts";

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
