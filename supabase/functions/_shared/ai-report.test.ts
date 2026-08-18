import { test } from "node:test";
import assert from "node:assert/strict";
import { dateOnly, dayRange, extractSuggestedAction } from "./ai-report.ts";

test("dateOnly: an early-morning KST instant is labeled with its KST date, not the earlier UTC date", () => {
  // 07:00 KST on 2026-08-18 = 22:00 UTC on 2026-08-17 — a UTC-anchored
  // dateOnly would wrongly say "2026-08-17" here.
  assert.equal(dateOnly(new Date("2026-08-17T22:00:00.000Z")), "2026-08-18");
});

test("dayRange: bounds span one KST calendar day (09:00 UTC boundary, not 00:00 UTC)", () => {
  const { start, end } = dayRange("2026-08-18");
  assert.equal(start, "2026-08-17T15:00:00.000Z"); // 00:00 KST on 08-18
  assert.equal(end, "2026-08-18T15:00:00.000Z"); // 00:00 KST on 08-19
});

test("extractSuggestedAction: strips a trailing ACTION line and returns it separately", () => {
  const { content, suggestedAction } = extractSuggestedAction(
    "오늘도 수고했어요.\n공부 시간이 목표에 조금 못 미쳤네요.\nACTION: 내일은 타이머를 미리 맞춰보세요.",
  );
  assert.equal(content, "오늘도 수고했어요.\n공부 시간이 목표에 조금 못 미쳤네요.");
  assert.equal(suggestedAction, "내일은 타이머를 미리 맞춰보세요.");
});

test("extractSuggestedAction: is case-insensitive on the ACTION prefix", () => {
  const { suggestedAction } = extractSuggestedAction("본문\naction: 소문자도 인식");
  assert.equal(suggestedAction, "소문자도 인식");
});

test("extractSuggestedAction: no ACTION line leaves content untouched and action null", () => {
  const { content, suggestedAction } = extractSuggestedAction("그냥 평범한 리포트 본문입니다.");
  assert.equal(content, "그냥 평범한 리포트 본문입니다.");
  assert.equal(suggestedAction, null);
});

test("extractSuggestedAction: an ACTION-looking phrase mid-body (not the last line) is not extracted", () => {
  const { content, suggestedAction } = extractSuggestedAction("ACTION: 이건 첫 줄이라 본문에 남아야 함\n그리고 마지막 줄");
  assert.equal(content, "ACTION: 이건 첫 줄이라 본문에 남아야 함\n그리고 마지막 줄");
  assert.equal(suggestedAction, null);
});
