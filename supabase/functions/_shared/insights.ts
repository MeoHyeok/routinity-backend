import {
  computeDailyScore,
  computeScores,
  goalsExistingBy,
  type GoalWithCreatedAt,
  type RoutineLog,
} from "./scoring.ts";
import { dateOnly, dayRange, filterLogsInRange } from "./ai-report.ts";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const WINDOW_DAYS = 28;

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

export interface LoadInsightsResult {
  data: InsightsResult | null;
  error: { message: string } | null;
}

// Minimal shape of the parts of the Supabase client this needs — the
// external SDK's client type isn't re-exported anywhere in this codebase for
// reuse, so callers just pass ctx.supabase (or ctx.supabaseAdmin) as-is.
// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

// Shared by /insights and the report endpoints (which enrich their AI
// prompt/template with the same pattern data) so the fetch-28-days +
// per-day-score + computeInsights pipeline exists in exactly one place.
export async function loadInsights(supabase: SupabaseLike, today: string): Promise<LoadInsightsResult> {
  const { start: todayStart, end: todayEnd } = dayRange(today);

  const dateList: string[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    dateList.push(dateOnly(new Date(new Date(todayStart).getTime() - i * 24 * 60 * 60 * 1000)));
  }
  const windowStart = dayRange(dateList[0]).start;

  const [goalsResult, logsResult] = await Promise.all([
    supabase.from("goals").select("target_type, target_value, created_at"),
    supabase
      .from("routine_logs")
      .select("type, timestamp")
      .gte("timestamp", windowStart)
      .lt("timestamp", todayEnd)
      .order("timestamp", { ascending: true }),
  ]);

  if (goalsResult.error) return { data: null, error: goalsResult.error };
  if (logsResult.error) return { data: null, error: logsResult.error };

  const goals: GoalWithCreatedAt[] = goalsResult.data ?? [];
  const allLogs: RoutineLog[] = logsResult.data ?? [];

  const dayScores: DayScore[] = dateList.map((date) => {
    const { start, end } = dayRange(date);
    const goalsAsOfDay = goalsExistingBy(goals, end);
    const dayLogs = filterLogsInRange(allLogs, start, end);
    const scores = computeScores(goalsAsOfDay, dayLogs);
    return { date, dailyScore: computeDailyScore(scores) };
  });

  return { data: computeInsights(dayScores, today), error: null };
}

// 0-2 Korean sentences narrating the pattern data, for splicing into a
// report's template text or Claude prompt. Shared by weekly-report.ts and
// daily-report.ts so both cadences describe patterns the same way.
export function describeInsights(insights: InsightsResult | null): string[] {
  if (!insights) return [];
  const lines: string[] = [];

  if (
    insights.best_weekday &&
    insights.worst_weekday &&
    insights.best_weekday.weekday !== insights.worst_weekday.weekday
  ) {
    lines.push(
      `${insights.best_weekday.label}요일에 가장 잘 지키고(평균 ${insights.best_weekday.avg_daily_score}점), ` +
        `${insights.worst_weekday.label}요일에 가장 많이 놓치는 편이에요(평균 ${insights.worst_weekday.avg_daily_score}점).`,
    );
  }

  if (insights.trend) {
    const { direction, recent_avg, previous_avg } = insights.trend;
    const verb = direction === "up" ? "올랐어요" : direction === "down" ? "떨어졌어요" : "비슷하게 유지되고 있어요";
    lines.push(`최근 일주일 평균이 지난주보다 ${verb} (${previous_avg}점 → ${recent_avg}점).`);
  }

  return lines;
}
