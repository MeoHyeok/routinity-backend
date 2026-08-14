import { TARGET_TYPE_LABEL } from "./scoring.ts";
import { describeInsights, type InsightsResult } from "./insights.ts";
import type { GoalStat } from "./weekly-report.ts";

// A rolling window, not a calendar month — consistent with /reports-weekly
// (rolling 7 days) and /reports-daily (today), and avoids a partial-month
// report for anyone who joined less than a month ago.
export const MONTHLY_WINDOW_DAYS = 30;

export function buildMonthlyTemplateReport(stats: GoalStat[], insights: InsightsResult | null = null): string {
  if (stats.length === 0) {
    return "최근 한 달은 설정된 목표가 없어 리포트를 생성할 수 없어요. 목표를 설정하면 다음 리포트부터 받아볼 수 있습니다.";
  }

  // Total is each goal's own scored-day count, not the window size — a goal
  // set partway through the month is only scored from then on (see
  // goalsExistingBy), so "30일 중" would overstate the denominator.
  const lines = stats.map((s) => {
    const label = TARGET_TYPE_LABEL[s.target_type] ?? s.target_type;
    const total = s.achieved + s.not_achieved + s.missing;
    return `${label}: 최근 ${total}일 중 ${s.achieved}일 달성, ${s.not_achieved}일 미달, ${s.missing}일 기록 없음`;
  });

  const patternLines = describeInsights(insights);
  const patternSection = patternLines.length > 0 ? ["", "패턴 분석", ...patternLines] : [];

  return ["최근 한 달 루티니티 리포트", "", ...lines, ...patternSection].join("\n");
}

export function buildMonthlyClaudePrompt(stats: GoalStat[], insights: InsightsResult | null = null): string {
  const lines = stats.map((s) => {
    const label = TARGET_TYPE_LABEL[s.target_type] ?? s.target_type;
    const total = s.achieved + s.not_achieved + s.missing;
    return `- ${label} (목표값: ${s.target_value}): 달성 ${s.achieved}일 / 미달 ${s.not_achieved}일 / 기록없음 ${s.missing}일 (최근 ${total}일 기준)`;
  });

  const patternLines = describeInsights(insights);
  const patternSection = patternLines.length > 0 ? ["", "추가로 파악된 패턴:", ...patternLines] : [];

  return [
    "다음은 한 사용자의 최근 한 달(30일) 루틴 목표 달성 현황이야.",
    ...lines,
    ...patternSection,
    "",
    "이 데이터를 바탕으로 격려하는 톤의 한국어 월간 리포트를 4~6문장으로 작성해줘. 과장하지 말고 데이터에 근거해서 구체적으로 작성해줘. 패턴 정보가 있다면 자연스럽게 녹여서 언급해줘.",
  ].join("\n");
}
