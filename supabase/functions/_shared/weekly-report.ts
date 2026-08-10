import type { ScoreEntry, ScoreStatus } from "./scoring.ts";

export interface DailyScores {
  date: string;
  scores: ScoreEntry[];
}

export interface GoalStat {
  target_type: string;
  target_value: string;
  achieved: number;
  not_achieved: number;
  missing: number;
}

const TARGET_TYPE_LABEL: Record<string, string> = {
  wake_time: "기상 목표",
  study_duration: "공부 시간 목표",
};

export function summarizeWeek(days: DailyScores[]): GoalStat[] {
  const byType = new Map<string, GoalStat>();

  for (const day of days) {
    for (const score of day.scores) {
      let stat = byType.get(score.target_type);
      if (!stat) {
        stat = {
          target_type: score.target_type,
          target_value: score.target_value,
          achieved: 0,
          not_achieved: 0,
          missing: 0,
        };
        byType.set(score.target_type, stat);
      }
      stat.target_value = score.target_value;
      bumpStatus(stat, score.status);
    }
  }

  return [...byType.values()];
}

function bumpStatus(stat: GoalStat, status: ScoreStatus) {
  if (status === "achieved") stat.achieved++;
  else if (status === "not_achieved") stat.not_achieved++;
  else stat.missing++;
}

export function buildTemplateReport(stats: GoalStat[]): string {
  if (stats.length === 0) {
    return "이번 주는 설정된 목표가 없어 리포트를 생성할 수 없어요. 목표를 설정하면 다음 주부터 리포트를 받아볼 수 있습니다.";
  }

  const lines = stats.map((s) => {
    const label = TARGET_TYPE_LABEL[s.target_type] ?? s.target_type;
    return `${label}: 7일 중 ${s.achieved}일 달성, ${s.not_achieved}일 미달, ${s.missing}일 기록 없음`;
  });

  return ["이번 주 루티니티 리포트", "", ...lines].join("\n");
}

export function buildClaudePrompt(stats: GoalStat[]): string {
  const lines = stats.map((s) => {
    const label = TARGET_TYPE_LABEL[s.target_type] ?? s.target_type;
    return `- ${label} (목표값: ${s.target_value}): 달성 ${s.achieved}일 / 미달 ${s.not_achieved}일 / 기록없음 ${s.missing}일`;
  });

  return [
    "다음은 한 사용자의 이번 주 루틴 목표 달성 현황이야.",
    ...lines,
    "",
    "이 데이터를 바탕으로 격려하는 톤의 한국어 주간 리포트를 3~5문장으로 작성해줘. 과장하지 말고 데이터에 근거해서 구체적으로 작성해줘.",
  ].join("\n");
}
