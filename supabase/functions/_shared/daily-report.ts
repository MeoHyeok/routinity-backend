import { TARGET_TYPE_LABEL, type ScoreEntry } from "./scoring.ts";
import { describeInsights, type InsightsResult } from "./insights.ts";
import { describeDayBreakdown, describeRawActivity, type DayBreakdown, type RawActivity } from "./day-breakdown.ts";

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
  rawActivity: RawActivity | null = null,
): string {
  const goalLines = scores.map(describeScore);
  const breakdownLines = describeDayBreakdown(breakdown);
  // Only meaningful when there's no full wake+sleep breakdown to show
  // instead — computeDayBreakdown is strictly more informative (it also has
  // rest time and the awake span), so prefer it whenever both exist.
  const rawActivityLines = breakdownLines.length === 0 ? describeRawActivity(rawActivity) : [];

  // "No data at all" (not just "no goals") is the real bail-out — a user
  // with zero goals but any logged activity (wake+sleep breakdown, or just
  // a study/meal session) still gets a report.
  if (goalLines.length === 0 && breakdownLines.length === 0 && rawActivityLines.length === 0) {
    return "오늘은 설정된 목표나 기록이 없어 리포트를 생성할 수 없어요. 목표를 설정하거나 하루를 기록하면 리포트를 받아볼 수 있습니다.";
  }

  const blocks: string[][] = [];
  if (dailyScore !== null) blocks.push([`오늘의 루틴 점수: ${dailyScore}점`]);
  if (goalLines.length > 0) blocks.push(goalLines);
  if (breakdownLines.length > 0) blocks.push(breakdownLines);
  else if (rawActivityLines.length > 0) blocks.push(rawActivityLines);
  const patternLines = describeInsights(insights);
  if (patternLines.length > 0) blocks.push(["패턴 분석", ...patternLines]);
  // Goal-less nudge: only when there's activity worth analyzing but nothing
  // to score it against — matches the "prescriptive next step" convention
  // used elsewhere in this file (see suggested-action.ts).
  if (goalLines.length === 0 && (breakdownLines.length > 0 || rawActivityLines.length > 0)) {
    blocks.push(["목표를 설정하면 오늘 기록을 목표 대비 달성률로도 볼 수 있어요."]);
  }

  const body = blocks.map((b) => b.join("\n")).join("\n\n");
  return `오늘의 루티니티 리포트\n\n${body}`;
}

export function buildDailyClaudePrompt(
  scores: ScoreEntry[],
  dailyScore: number | null,
  insights: InsightsResult | null = null,
  breakdown: DayBreakdown | null = null,
  rawActivity: RawActivity | null = null,
): string {
  const goalLines = scores.map(describeScore);
  const breakdownLines = describeDayBreakdown(breakdown);
  const rawActivityLines = breakdownLines.length === 0 ? describeRawActivity(rawActivity) : [];
  const patternLines = describeInsights(insights);
  const hasGoals = goalLines.length > 0;

  const sections: string[] = ["다음은 한 사용자의 오늘 하루 루틴 기록이야."];
  if (dailyScore !== null) sections.push(`오늘의 루틴 점수: ${dailyScore}점`);
  sections.push(...goalLines);
  if (breakdownLines.length > 0) sections.push("", ...breakdownLines);
  else if (rawActivityLines.length > 0) sections.push("", ...rawActivityLines);
  if (patternLines.length > 0) sections.push("", "추가로 파악된 패턴:", ...patternLines);

  if (hasGoals) {
    sections.push(
      "",
      "이 데이터를 바탕으로 격려하는 톤의 한국어 일간 리포트를 2~3문장으로 작성해줘. 과장하지 말고 데이터에 근거해서 구체적으로 작성해줘. 패턴 정보가 있다면 자연스럽게 녹여서 언급해줘.",
      "그 다음, 이 데이터에서 가장 큰 로스(개선 여지) 하나를 짚어서 지금 바로 실천할 수 있는 구체적인 행동 한 가지를 제안해줘. 리포트 본문에는 이 제안을 포함하지 말고, 응답의 맨 마지막 줄에만 다음 형식 그대로 작성해줘: ACTION: <한 문장 제안>",
    );
  } else {
    // No goals set — there's nothing to score "achieved/missed" against, so
    // don't ask the model to invent an achievement framing. Just narrate
    // what was actually logged, then nudge toward setting a goal.
    //
    // With only a handful of raw activity lines to work with, a model asked
    // for "2-3 encouraging sentences" tends to pad the gap by inventing
    // plausible-sounding routine details (a morning walk, reading, drinking
    // water — none of which were ever logged) rather than admitting there's
    // little to say. The "과장하지 말고" line alone didn't stop this in
    // testing, so spell out the constraint explicitly and give it an
    // explicit escape hatch (a short response is fine) instead of pressure
    // to fill 2-3 sentences regardless of how little data there is.
    sections.push(
      "",
      "이 사용자는 아직 목표를 설정하지 않았고, 그냥 그날그날 기록만 남기고 있어. 달성/미달성 같은 평가 없이, 위에 적힌 기록만 가지고 격려하는 톤으로 요약해줘.",
      "절대 지키기: 위에 적히지 않은 활동(예: 산책, 독서, 수분 섭취 등)은 절대 언급하지 마. 기록에 없는 걸 있는 것처럼 지어내지 말고, 위 기록에 실제로 있는 항목만 가지고 이야기해. 기록이 짧으면 요약도 짧아도 괜찮아 — 억지로 2~3문장을 채우려고 없는 내용을 추가하지 마.",
      "그 다음, 목표를 설정하면 어떤 점이 좋아지는지 짧고 구체적으로 한 문장 제안해줘. 리포트 본문에는 이 제안을 포함하지 말고, 응답의 맨 마지막 줄에만 다음 형식 그대로 작성해줘: ACTION: <한 문장 제안>",
    );
  }

  return sections.join("\n");
}
