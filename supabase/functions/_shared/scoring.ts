export type ScoreStatus = "achieved" | "not_achieved" | "missing";

export interface Goal {
  target_type: string;
  target_value: string;
}

export interface RoutineLog {
  type: string;
  timestamp: string;
}

export interface ScoreEntry {
  target_type: string;
  target_value: string;
  actual_value: string | null;
  status: ScoreStatus;
}

const SCORABLE_TYPES = new Set(["wake_time", "study_duration"]);

export function computeScores(goals: Goal[], logs: RoutineLog[]): ScoreEntry[] {
  return goals
    .filter((goal) => SCORABLE_TYPES.has(goal.target_type))
    .map((goal) => scoreGoal(goal, logs));
}

function scoreGoal(goal: Goal, logs: RoutineLog[]): ScoreEntry {
  if (goal.target_type === "wake_time") {
    return scoreWakeTime(goal, logs);
  }
  return scoreStudyDuration(goal, logs);
}

function scoreWakeTime(goal: Goal, logs: RoutineLog[]): ScoreEntry {
  // Postgres doesn't guarantee row order without ORDER BY, and a day can have
  // more than one "wake" log (correction, snooze, etc.) — always take the
  // earliest by timestamp rather than whichever the DB happened to return first.
  const wakeLog = logs
    .filter((log) => log.type === "wake")
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))[0];
  if (!wakeLog) {
    return {
      target_type: goal.target_type,
      target_value: goal.target_value,
      actual_value: null,
      status: "missing",
    };
  }

  const actual = new Date(wakeLog.timestamp).toISOString().slice(11, 16);
  return {
    target_type: goal.target_type,
    target_value: goal.target_value,
    actual_value: actual,
    status: actual <= goal.target_value ? "achieved" : "not_achieved",
  };
}

// How many minutes late a wake_time can be before its partial credit bottoms
// out at 0 — a somewhat arbitrary grace window, tunable if the score feels
// too harsh/lenient in practice.
const WAKE_TIME_LATE_GRACE_MINUTES = 120;

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Per-goal credit in [0, 1]. `missing` always gets 0 — there's no data to
// judge closeness by, so no partial credit. `not_achieved` gets partial
// credit based on how close the actual value came to the target, so the
// daily score isn't just achieved-goal-count/total (which only ever lands
// on a handful of coarse values when there are just 1-2 scorable goals).
function scoreCredit(score: ScoreEntry): number {
  if (score.status === "achieved") return 1;
  if (score.status === "missing" || score.actual_value === null) return 0;

  if (score.target_type === "study_duration") {
    const actual = Number(score.actual_value);
    const target = Number(score.target_value);
    if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) return 0;
    return Math.max(0, Math.min(actual / target, 1));
  }

  if (score.target_type === "wake_time") {
    const lateMinutes = timeToMinutes(score.actual_value) - timeToMinutes(score.target_value);
    return Math.max(0, 1 - lateMinutes / WAKE_TIME_LATE_GRACE_MINUTES);
  }

  return 0;
}

export function computeDailyScore(scores: ScoreEntry[]): number | null {
  if (scores.length === 0) return null;
  const total = scores.reduce((sum, s) => sum + scoreCredit(s), 0);
  return Math.round((total / scores.length) * 100);
}

function scoreStudyDuration(goal: Goal, logs: RoutineLog[]): ScoreEntry {
  const targetMinutes = Number(goal.target_value);
  const studyLogs = logs
    .filter((log) => log.type === "study_start" || log.type === "study_end")
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (studyLogs.length === 0 || Number.isNaN(targetMinutes)) {
    return {
      target_type: goal.target_type,
      target_value: goal.target_value,
      actual_value: null,
      status: "missing",
    };
  }

  let totalMs = 0;
  let openStart: number | null = null;
  for (const log of studyLogs) {
    const t = new Date(log.timestamp).getTime();
    if (log.type === "study_start") {
      openStart = t;
    } else if (openStart !== null) {
      totalMs += t - openStart;
      openStart = null;
    }
  }

  const actualMinutes = Math.round(totalMs / 60000);
  return {
    target_type: goal.target_type,
    target_value: goal.target_value,
    actual_value: String(actualMinutes),
    status: actualMinutes >= targetMinutes ? "achieved" : "not_achieved",
  };
}
