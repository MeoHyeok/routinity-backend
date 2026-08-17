import { TARGET_TYPE_LABEL, type ScoreEntry, type ScoreStatus } from "./scoring.ts";
import { describeInsights, type InsightsResult } from "./insights.ts";
import { describeAverageBreakdown, type AverageBreakdown } from "./day-breakdown.ts";

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

export function buildTemplateReport(
  stats: GoalStat[],
  insights: InsightsResult | null = null,
  breakdown: AverageBreakdown | null = null,
): string {
  const breakdownLines = describeAverageBreakdown(breakdown);

  // Time-breakdown data doesn't depend on having any goal set (see
  // daily-report.ts's identical rationale).
  if (stats.length === 0 && breakdownLines.length === 0) {
    return "이번 주는 설정된 목표나 기록이 없어 리포트를 생성할 수 없어요. 목표를 설정하거나 하루를 기록하면 다음 주부터 리포트를 받아볼 수 있습니다.";
  }

  const goalLines = stats.map((s) => {
    const label = TARGET_TYPE_LABEL[s.target_type] ?? s.target_type;
    // Total is the goal's own scored-day count, not the window size — a
    // goal set partway through the week is only scored from then on (see
    // goalsExistingBy), so "7일 중" would overstate the denominator.
    const total = s.achieved + s.not_achieved + s.missing;
    return `${label}: ${total}일 중 ${s.achieved}일 달성, ${s.not_achieved}일 미달, ${s.missing}일 기록 없음`;
  });

  const blocks: string[][] = [];
  if (goalLines.length > 0) blocks.push(goalLines);
  if (breakdownLines.length > 0) blocks.push(breakdownLines);
  const patternLines = describeInsights(insights);
  if (patternLines.length > 0) blocks.push(["패턴 분석", ...patternLines]);

  const body = blocks.map((b) => b.join("\n")).join("\n\n");
  return `이번 주 루티니티 리포트\n\n${body}`;
}

export function buildClaudePrompt(
  stats: GoalStat[],
  insights: InsightsResult | null = null,
  breakdown: AverageBreakdown | null = null,
): string {
  const goalLines = stats.map((s) => {
    const label = TARGET_TYPE_LABEL[s.target_type] ?? s.target_type;
    return `- ${label} (목표값: ${s.target_value}): 달성 ${s.achieved}일 / 미달 ${s.not_achieved}일 / 기록없음 ${s.missing}일`;
  });
  const breakdownLines = describeAverageBreakdown(breakdown);
  const patternLines = describeInsights(insights);

  const sections = ["다음은 한 사용자의 이번 주 루틴 목표 달성 현황이야.", ...goalLines];
  if (breakdownLines.length > 0) sections.push("", ...breakdownLines);
  if (patternLines.length > 0) sections.push("", "추가로 파악된 패턴:", ...patternLines);
  sections.push(
    "",
    "이 데이터를 바탕으로 격려하는 톤의 한국어 주간 리포트를 3~5문장으로 작성해줘. 과장하지 말고 데이터에 근거해서 구체적으로 작성해줘. 패턴 정보가 있다면 자연스럽게 녹여서 언급해줘.",
  );

  return sections.join("\n");
}
