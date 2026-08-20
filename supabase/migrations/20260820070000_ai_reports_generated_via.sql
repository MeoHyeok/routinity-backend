-- time_breakdown/suggested_action처럼 generated_via도 생성 시점 값을 저장하지
-- 않고 매번 요청 핸들러에서 그때그때 계산만 해서 응답에 넣었다 — 그래서 캐시
-- 히트(cached: true) 응답에는 애초에 실을 값이 없어 필드 자체가 항상 빠졌다.
-- iOS 통합 테스트 중 발견: 클라이언트가 이 필드 없음을 "template"으로 보수적
-- 해석해서, 실제로는 AI가 생성한 리포트도 그날 두 번째 조회부터는 "기본
-- 템플릿 리포트"로 잘못 표시됨. time_breakdown/suggested_action과 동일한
-- 이유로 생성 시점에 함께 저장해서 캐시 재조회 시에도 값이 그대로 나오게 한다.
alter table ai_reports add column generated_via text;
