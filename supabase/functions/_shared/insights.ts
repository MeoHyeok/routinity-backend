const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

// Point difference within which two averages are called "flat" rather than
// up/down — otherwise 1-2 point rounding noise would read as a trend.
const TREND_FLAT_THRESHOLD = 3;

export interface DayScore {
  date: string; // YYYY-MM-DD, UTC
  dailyScore: number | null;
}

export interface WeekdayAverage {
  weekday: number; // 0 = Sun .. 6 = Sat, UTC
  label: string;
  avg_daily_score: number;
  days_counted: number;
}

export interface WeekdayHighlight {
  weekday: number;
  label: string;
  avg_daily_score: number;
}

export interface Trend {
  direction: "up" | "down" | "flat";
  recent_avg: number;
  previous_avg: number;
}

export interface InsightsResult {
  weekday_averages: WeekdayAverage[];
  best_weekday: WeekdayHighlight | null;
  worst_weekday: WeekdayHighlight | null;
  trend: Trend | null;
}

function daysBetweenUTC(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

export function computeInsights(days: DayScore[], today: string): InsightsResult {
  const byWeekday = new Map<number, { sum: number; count: number }>();
  let recentSum = 0;
  let recentCount = 0;
  let previousSum = 0;
  let previousCount = 0;

  for (const day of days) {
    if (day.dailyScore === null) continue;

    const weekday = weekdayOf(day.date);
    const bucket = byWeekday.get(weekday) ?? { sum: 0, count: 0 };
    bucket.sum += day.dailyScore;
    bucket.count += 1;
    byWeekday.set(weekday, bucket);

    const offset = daysBetweenUTC(day.date, today);
    if (offset >= 0 && offset <= 6) {
      recentSum += day.dailyScore;
      recentCount += 1;
    } else if (offset >= 7 && offset <= 13) {
      previousSum += day.dailyScore;
      previousCount += 1;
    }
  }

  const weekday_averages: WeekdayAverage[] = [...byWeekday.entries()]
    .map(([weekday, { sum, count }]) => ({
      weekday,
      label: WEEKDAY_LABELS[weekday],
      avg_daily_score: Math.round(sum / count),
      days_counted: count,
    }))
    .sort((a, b) => a.weekday - b.weekday);

  let best_weekday: WeekdayHighlight | null = null;
  let worst_weekday: WeekdayHighlight | null = null;
  if (weekday_averages.length > 0) {
    const byScore = [...weekday_averages].sort((a, b) => b.avg_daily_score - a.avg_daily_score);
    const best = byScore[0];
    const worst = byScore[byScore.length - 1];
    best_weekday = { weekday: best.weekday, label: best.label, avg_daily_score: best.avg_daily_score };
    worst_weekday = { weekday: worst.weekday, label: worst.label, avg_daily_score: worst.avg_daily_score };
  }

  let trend: Trend | null = null;
  if (recentCount > 0 && previousCount > 0) {
    const recent_avg = Math.round(recentSum / recentCount);
    const previous_avg = Math.round(previousSum / previousCount);
    const diff = recent_avg - previous_avg;
    const direction = diff > TREND_FLAT_THRESHOLD ? "up" : diff < -TREND_FLAT_THRESHOLD ? "down" : "flat";
    trend = { direction, recent_avg, previous_avg };
  }

  return { weekday_averages, best_weekday, worst_weekday, trend };
}
