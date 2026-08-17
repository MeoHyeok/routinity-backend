import { test } from "node:test";
import assert from "node:assert/strict";
import {
  averageDayBreakdowns,
  computeDayBreakdown,
  describeAverageBreakdown,
  describeDayBreakdown,
  formatMinutes,
} from "./day-breakdown.ts";

test("formatMinutes: renders hours and minutes, omitting a zero part", () => {
  assert.equal(formatMinutes(0), "0분");
  assert.equal(formatMinutes(45), "45분");
  assert.equal(formatMinutes(60), "1시간");
  assert.equal(formatMinutes(150), "2시간 30분");
});

test("computeDayBreakdown: null without both a wake and a later sleep log", () => {
  assert.equal(computeDayBreakdown([]), null);
  assert.equal(computeDayBreakdown([{ type: "wake", timestamp: "2026-08-14T06:00:00Z" }]), null);
  assert.equal(computeDayBreakdown([{ type: "sleep", timestamp: "2026-08-14T23:00:00Z" }]), null);
});

test("computeDayBreakdown: null when sleep is not after wake", () => {
  const logs = [
    { type: "sleep", timestamp: "2026-08-14T05:00:00Z" },
    { type: "wake", timestamp: "2026-08-14T06:00:00Z" },
  ];
  assert.equal(computeDayBreakdown(logs), null);
});

test("computeDayBreakdown: splits the awake span into meal/study/rest", () => {
  const logs = [
    { type: "wake", timestamp: "2026-08-14T06:00:00Z" }, // 06:00
    { type: "meal_start", timestamp: "2026-08-14T07:00:00Z" },
    { type: "meal_end", timestamp: "2026-08-14T07:30:00Z" }, // 30 min meal
    { type: "study_start", timestamp: "2026-08-14T09:00:00Z" },
    { type: "study_end", timestamp: "2026-08-14T10:00:00Z" }, // 60 min study
    { type: "sleep", timestamp: "2026-08-14T22:00:00Z" }, // 22:00 -> 16h awake = 960 min
  ];
  const b = computeDayBreakdown(logs)!;
  assert.equal(b.wakeTime, "06:00");
  assert.equal(b.sleepTime, "22:00");
  assert.equal(b.awakeMinutes, 960);
  assert.equal(b.mealMinutes, 30);
  assert.equal(b.studyMinutes, 60);
  assert.equal(b.restMinutes, 960 - 30 - 60);
});

test("computeDayBreakdown: rest floors at 0 rather than going negative", () => {
  const logs = [
    { type: "wake", timestamp: "2026-08-14T06:00:00Z" },
    { type: "study_start", timestamp: "2026-08-14T06:30:00Z" },
    { type: "study_end", timestamp: "2026-08-14T21:30:00Z" }, // 15h study, only 1h awake span
    { type: "sleep", timestamp: "2026-08-14T07:00:00Z" },
  ];
  const b = computeDayBreakdown(logs)!;
  assert.equal(b.awakeMinutes, 60);
  assert.equal(b.studyMinutes, 900);
  assert.equal(b.restMinutes, 0);
});

test("computeDayBreakdown: earliest wake, latest sleep wins on same-day duplicates", () => {
  const logs = [
    { type: "wake", timestamp: "2026-08-14T07:00:00Z" },
    { type: "wake", timestamp: "2026-08-14T06:00:00Z" },
    { type: "sleep", timestamp: "2026-08-14T22:00:00Z" },
    { type: "sleep", timestamp: "2026-08-14T23:00:00Z" },
  ];
  const b = computeDayBreakdown(logs)!;
  assert.equal(b.wakeTime, "06:00");
  assert.equal(b.sleepTime, "23:00");
});

test("averageDayBreakdowns: null when no day has a breakdown", () => {
  assert.equal(averageDayBreakdowns([null, null]), null);
});

test("averageDayBreakdowns: averages only over days with a breakdown", () => {
  const a = computeDayBreakdown([
    { type: "wake", timestamp: "2026-08-13T06:00:00Z" },
    { type: "sleep", timestamp: "2026-08-13T22:00:00Z" },
  ]); // 960 min awake, 0 meal, 0 study, 960 rest
  const b = computeDayBreakdown([
    { type: "wake", timestamp: "2026-08-14T08:00:00Z" },
    { type: "sleep", timestamp: "2026-08-14T20:00:00Z" },
  ]); // 720 min awake, 0 meal, 0 study, 720 rest
  const avg = averageDayBreakdowns([a, null, b])!;
  assert.equal(avg.daysCounted, 2);
  assert.equal(avg.avgAwakeMinutes, 840);
  assert.equal(avg.avgRestMinutes, 840);
});

test("describeDayBreakdown: empty for null, four lines otherwise", () => {
  assert.deepEqual(describeDayBreakdown(null), []);
  const lines = describeDayBreakdown({
    wakeTime: "06:50",
    sleepTime: "23:30",
    awakeMinutes: 1000,
    mealMinutes: 90,
    studyMinutes: 60,
    restMinutes: 850,
  });
  assert.match(lines[0], /하루 시간 분배/);
  assert.match(lines[1], /06:50.*23:30/);
  assert.match(lines[2], /1시간 30분/);
  assert.match(lines[3], /1시간/);
  assert.match(lines[4], /14시간 10분/);
});

test("describeAverageBreakdown: empty for null, includes the day count", () => {
  assert.deepEqual(describeAverageBreakdown(null), []);
  const lines = describeAverageBreakdown({
    daysCounted: 5,
    avgAwakeMinutes: 900,
    avgMealMinutes: 80,
    avgStudyMinutes: 45,
    avgRestMinutes: 775,
  });
  assert.match(lines[0], /5일 기준/);
});
