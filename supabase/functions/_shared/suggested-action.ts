import { scoreCredit, type ScoreEntry } from "./scoring.ts";
import type { GoalStat } from "./weekly-report.ts";

// Rule-based fallback for `suggested_action` — used for the template report
// path, and as a backstop when Claude's response doesn't include a
// parseable ACTION line (see ai-report.ts's extractSuggestedAction). Picks
// the single worst-scoring goal and turns it into one concrete next step;
// returns null when there's nothing to flag (no scorable goals, or
// everything already achieved).
const DAILY_ACTION_BY_TYPE: Record<string, (s: ScoreEntry) => string> = {
  wake_time: () => "내일은 알람을 목표 시간보다 10분 일찍 맞춰서 기상 목표에 여유를 만들어보세요.",
  study_duration: (s) => {
    const target = Number(s.target_value);
    const actual = s.actual_value === null ? 0 : Number(s.actual_value);
    const gap = Number.isFinite(target) && Number.isFinite(actual) ? Math.round(target - actual) : null;
    return gap !== null && gap > 0
      ? `공부 시간이 목표보다 ${gap}분 부족했어요. 내일은 공부 시작 전에 타이머를 목표 시간(${target}분)에 맞춰보세요.`
      : "내일은 공부 시작 전에 목표 시간만큼 타이머를 맞춰보세요.";
  },
};

export function deriveDailySuggestedAction(scores: ScoreEntry[]): string | null {
  if (scores.length === 0) return null;
  const worst = [...scores].sort((a, b) => scoreCredit(a) - scoreCredit(b))[0];
  if (scoreCredit(worst) >= 1) return null;
  return DAILY_ACTION_BY_TYPE[worst.target_type]?.(worst) ?? null;
}

// Weekly/monthly variant — GoalStat only carries per-status day counts (not
// per-day actual values), so "worst" here is the goal with the lowest
// achieved-day ratio rather than a credit score.
const WINDOW_ACTION_BY_TYPE: Record<string, () => string> = {
  wake_time: () => "다음엔 알람을 목표 시간보다 10분 일찍 맞춰서 기상 목표 달성률을 높여보세요.",
  study_duration: () => "다음엔 공부 시작 전에 목표 시간만큼 타이머를 맞춰서 공부 시간을 채워보세요.",
};

function achievedRatio(s: GoalStat): number {
  const total = s.achieved + s.not_achieved + s.missing;
  return total === 0 ? 1 : s.achieved / total;
}

export function deriveWindowSuggestedAction(stats: GoalStat[]): string | null {
  const scored = stats.filter((s) => s.achieved + s.not_achieved + s.missing > 0);
  if (scored.length === 0) return null;
  const worst = [...scored].sort((a, b) => achievedRatio(a) - achievedRatio(b))[0];
  if (achievedRatio(worst) >= 1) return null;
  return WINDOW_ACTION_BY_TYPE[worst.target_type]?.() ?? null;
}
