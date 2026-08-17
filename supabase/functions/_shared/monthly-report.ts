import { TARGET_TYPE_LABEL } from "./scoring.ts";
import { describeInsights, type InsightsResult } from "./insights.ts";
import { describeAverageBreakdown, type AverageBreakdown } from "./day-breakdown.ts";
import type { GoalStat } from "./weekly-report.ts";

// A rolling window, not a calendar month — consistent with /reports-weekly
// (rolling 7 days) and /reports-daily (today), and avoids a partial-month
// report for anyone who joined less than a month ago.
export const MONTHLY_WINDOW_DAYS = 30;

export function buildMonthlyTemplateReport(
  stats: GoalStat[],
  insights: InsightsResult | null = null,
  breakdown: AverageBreakdown | null = null,
): string {
  const breakdownLines = describeAverageBreakdown(breakdown);

  // Time-breakdown data doesn't depend on having any goal set (see
  // daily-report.ts's identical rationale).
  if (stats.length === 0 && breakdownLines.length === 0) {
    return "최근 한 달은 설정된 목표나 기록이 없어 리포트를 생성할 수 없어요. 목표를 설정하거나 하루를 기록하면 다음 리포트부터 받아볼 수 있습니다.";
  }

  // Total is each goal's own scored-day count, not the window size — a goal
  // set partway through the month is only scored from then on (see
  // goalsExistingBy), so "30일 중" would overstate the denominator.
  const goalLines = stats.map((s) => {
    const label = TARGET_TYPE_LABEL[s.target_type] ?? s.target_type;
    const total = s.achieved + s.not_achieved + s.missing;
    return `${label}: 최근 ${total}일 중 ${s.achieved}일 달성, ${s.not_achieved}일 미달, ${s.missing}일 기록 없음`;
  });

  const blocks: string[][] = [];
  if (goalLines.length > 0) blocks.push(goalLines);
  if (breakdownLines.length > 0) blocks.push(breakdownLines);
  const patternLines = describeInsights(insights);
  if (patternLines.length > 0) blocks.push(["패턴 분석", ...patternLines]);

  const body = blocks.map((b) => b.join("\n")).join("\n\n");
  return `최근 한 달 루티니티 리포트\n\n${body}`;
}

export function buildMonthlyClaudePrompt(
  stats: GoalStat[],
  insights: InsightsResult | null = null,
  breakdown: AverageBreakdown | null = null,
): string {
  const goalLines = stats.map((s) => {
    const label = TARGET_TYPE_LABEL[s.target_type] ?? s.target_type;
    const total = s.achieved + s.not_achieved + s.missing;
    return `- ${label} (목표값: ${s.target_value}): 달성 ${s.achieved}일 / 미달 ${s.not_achieved}일 / 기록없음 ${s.missing}일 (최근 ${total}일 기준)`;
  });
  const breakdownLines = describeAverageBreakdown(breakdown);
  const patternLines = describeInsights(insights);

  const sections = ["다음은 한 사용자의 최근 한 달(30일) 루틴 목표 달성 현황이야.", ...goalLines];
  if (breakdownLines.length > 0) sections.push("", ...breakdownLines);
  if (patternLines.length > 0) sections.push("", "추가로 파악된 패턴:", ...patternLines);
  sections.push(
    "",
    "이 데이터를 바탕으로 격려하는 톤의 한국어 월간 리포트를 4~6문장으로 작성해줘. 과장하지 말고 데이터에 근거해서 구체적으로 작성해줘. 패턴 정보가 있다면 자연스럽게 녹여서 언급해줘.",
    "그 다음, 이 데이터에서 가장 큰 로스(개선 여지) 하나를 짚어서 앞으로 바로 실천할 수 있는 구체적인 행동 한 가지를 제안해줘. 리포트 본문에는 이 제안을 포함하지 말고, 응답의 맨 마지막 줄에만 다음 형식 그대로 작성해줘: ACTION: <한 문장 제안>",
  );

  return sections.join("\n");
}
