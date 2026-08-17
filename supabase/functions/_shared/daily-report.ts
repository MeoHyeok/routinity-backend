import { TARGET_TYPE_LABEL, type ScoreEntry } from "./scoring.ts";
import { describeInsights, type InsightsResult } from "./insights.ts";
import { describeDayBreakdown, type DayBreakdown } from "./day-breakdown.ts";

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
  breakdown: DayBreakdown | null = null,
): string {
  const goalLines = scores.map(describeScore);
  const breakdownLines = describeDayBreakdown(breakdown);

  // Time-breakdown data doesn't depend on having any goal set — a user who
  // only logs wake/sleep/meal/study without setting a goal still gets a
  // report, so "no data at all" (not just "no goals") is the real bail-out.
  if (goalLines.length === 0 && breakdownLines.length === 0) {
    return "오늘은 설정된 목표나 기록이 없어 리포트를 생성할 수 없어요. 목표를 설정하거나 하루를 기록하면 리포트를 받아볼 수 있습니다.";
  }

  const blocks: string[][] = [];
  if (dailyScore !== null) blocks.push([`오늘의 루틴 점수: ${dailyScore}점`]);
  if (goalLines.length > 0) blocks.push(goalLines);
  if (breakdownLines.length > 0) blocks.push(breakdownLines);
  const patternLines = describeInsights(insights);
  if (patternLines.length > 0) blocks.push(["패턴 분석", ...patternLines]);

  const body = blocks.map((b) => b.join("\n")).join("\n\n");
  return `오늘의 루티니티 리포트\n\n${body}`;
}

export function buildDailyClaudePrompt(
  scores: ScoreEntry[],
  dailyScore: number | null,
  insights: InsightsResult | null = null,
  breakdown: DayBreakdown | null = null,
): string {
  const goalLines = scores.map(describeScore);
  const breakdownLines = describeDayBreakdown(breakdown);
  const patternLines = describeInsights(insights);

  const sections: string[] = ["다음은 한 사용자의 오늘 하루 루틴 목표 달성 현황이야."];
  if (dailyScore !== null) sections.push(`오늘의 루틴 점수: ${dailyScore}점`);
  sections.push(...goalLines);
  if (breakdownLines.length > 0) sections.push("", ...breakdownLines);
  if (patternLines.length > 0) sections.push("", "추가로 파악된 패턴:", ...patternLines);
  sections.push(
    "",
    "이 데이터를 바탕으로 격려하는 톤의 한국어 일간 리포트를 2~3문장으로 작성해줘. 과장하지 말고 데이터에 근거해서 구체적으로 작성해줘. 패턴 정보가 있다면 자연스럽게 녹여서 언급해줘.",
    "그 다음, 이 데이터에서 가장 큰 로스(개선 여지) 하나를 짚어서 지금 바로 실천할 수 있는 구체적인 행동 한 가지를 제안해줘. 리포트 본문에는 이 제안을 포함하지 말고, 응답의 맨 마지막 줄에만 다음 형식 그대로 작성해줘: ACTION: <한 문장 제안>",
  );

  return sections.join("\n");
}
