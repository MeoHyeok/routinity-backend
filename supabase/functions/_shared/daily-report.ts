import { TARGET_TYPE_LABEL, type ScoreEntry } from "./scoring.ts";
import { describeInsights, type InsightsResult } from "./insights.ts";

function describeScore(s: ScoreEntry): string {
  const label = TARGET_TYPE_LABEL[s.target_type] ?? s.target_type;
  if (s.status === "achieved") {
    return `${label}: 목표 ${s.target_value}, 실제 ${s.actual_value} — 달성`;
  }
  if (s.status === "not_achieved") {
    return `${label}: 목표 ${s.target_value}, 실제 ${s.actual_value} — 미달성`;
  }
  return `${label}: 기록 없음`;
}

export function buildDailyTemplateReport(
  scores: ScoreEntry[],
  dailyScore: number | null,
  insights: InsightsResult | null = null,
): string {
  if (scores.length === 0) {
    return "오늘은 설정된 목표가 없어 리포트를 생성할 수 없어요. 목표를 설정하면 오늘부터 리포트를 받아볼 수 있습니다.";
  }

  const lines = scores.map(describeScore);
  const patternLines = describeInsights(insights);
  const patternSection = patternLines.length > 0 ? ["", "패턴 분석", ...patternLines] : [];

  return ["오늘의 루티니티 리포트", "", `오늘의 루틴 점수: ${dailyScore}점`, "", ...lines, ...patternSection].join("\n");
}

export function buildDailyClaudePrompt(
  scores: ScoreEntry[],
  dailyScore: number | null,
  insights: InsightsResult | null = null,
): string {
  const lines = scores.map(describeScore);
  const patternLines = describeInsights(insights);
  const patternSection = patternLines.length > 0 ? ["", "추가로 파악된 패턴:", ...patternLines] : [];

  return [
    "다음은 한 사용자의 오늘 하루 루틴 목표 달성 현황이야.",
    `오늘의 루틴 점수: ${dailyScore}점`,
    ...lines,
    ...patternSection,
    "",
    "이 데이터를 바탕으로 격려하는 톤의 한국어 일간 리포트를 2~3문장으로 작성해줘. 과장하지 말고 데이터에 근거해서 구체적으로 작성해줘. 패턴 정보가 있다면 자연스럽게 녹여서 언급해줘.",
  ].join("\n");
}
