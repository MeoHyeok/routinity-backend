import { sumPairedMinutes, type RoutineLog } from "./scoring.ts";

export interface DayBreakdown {
  wakeTime: string; // HH:MM
  sleepTime: string; // HH:MM
  awakeMinutes: number;
  mealMinutes: number;
  studyMinutes: number;
  restMinutes: number;
}

export interface AverageBreakdown {
  daysCounted: number;
  avgAwakeMinutes: number;
  avgMealMinutes: number;
  avgStudyMinutes: number;
  avgRestMinutes: number;
}

function timeOf(log: RoutineLog): string {
  return new Date(log.timestamp).toISOString().slice(11, 16);
}

// Requires both a "wake" and a later "sleep" log the same day — without a
// bedtime marker there's no way to know how long the "awake span" was, so
// meal/study/rest can't be split out. Earliest wake, latest sleep (mirrors
// scoreWakeTime's "earliest wins" rule and tolerates a same-day correction).
export function computeDayBreakdown(logs: RoutineLog[]): DayBreakdown | null {
  const wakeLogs = logs.filter((l) => l.type === "wake").sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const sleepLogs = logs.filter((l) => l.type === "sleep").sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (wakeLogs.length === 0 || sleepLogs.length === 0) return null;

  const wake = wakeLogs[0];
  const sleep = sleepLogs[sleepLogs.length - 1];
  const wakeMs = new Date(wake.timestamp).getTime();
  const sleepMs = new Date(sleep.timestamp).getTime();
  if (sleepMs <= wakeMs) return null;

  const awakeMinutes = Math.round((sleepMs - wakeMs) / 60_000);
  const mealMinutes = sumPairedMinutes(logs, "meal_start", "meal_end");
  const studyMinutes = sumPairedMinutes(logs, "study_start", "study_end");
  // Can't go negative — an overlap or logging mistake shouldn't produce a
  // nonsensical negative rest time. The other three numbers stay exact even
  // when this clamps, so they may not sum to awakeMinutes in that case.
  const restMinutes = Math.max(0, awakeMinutes - mealMinutes - studyMinutes);

  return { wakeTime: timeOf(wake), sleepTime: timeOf(sleep), awakeMinutes, mealMinutes, studyMinutes, restMinutes };
}

export function averageDayBreakdowns(breakdowns: (DayBreakdown | null)[]): AverageBreakdown | null {
  const valid = breakdowns.filter((b): b is DayBreakdown => b !== null);
  if (valid.length === 0) return null;

  const avg = (sum: number) => Math.round(sum / valid.length);
  return {
    daysCounted: valid.length,
    avgAwakeMinutes: avg(valid.reduce((s, b) => s + b.awakeMinutes, 0)),
    avgMealMinutes: avg(valid.reduce((s, b) => s + b.mealMinutes, 0)),
    avgStudyMinutes: avg(valid.reduce((s, b) => s + b.studyMinutes, 0)),
    avgRestMinutes: avg(valid.reduce((s, b) => s + b.restMinutes, 0)),
  };
}

export function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

export function describeDayBreakdown(b: DayBreakdown | null): string[] {
  if (!b) return [];
  return [
    "하루 시간 분배",
    `활동 시간: 기상 ${b.wakeTime} ~ 취침 ${b.sleepTime} (${formatMinutes(b.awakeMinutes)})`,
    `식사 시간: ${formatMinutes(b.mealMinutes)}`,
    `공부 시간: ${formatMinutes(b.studyMinutes)}`,
    `휴식 시간: ${formatMinutes(b.restMinutes)}`,
  ];
}

export function describeAverageBreakdown(avg: AverageBreakdown | null): string[] {
  if (!avg) return [];
  return [
    `일평균 시간 분배 (활동 기록 있는 ${avg.daysCounted}일 기준)`,
    `활동 시간: 일평균 ${formatMinutes(avg.avgAwakeMinutes)}`,
    `식사 시간: 일평균 ${formatMinutes(avg.avgMealMinutes)}`,
    `공부 시간: 일평균 ${formatMinutes(avg.avgStudyMinutes)}`,
    `휴식 시간: 일평균 ${formatMinutes(avg.avgRestMinutes)}`,
  ];
}
