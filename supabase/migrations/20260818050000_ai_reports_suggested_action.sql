-- iOS 리포트 최상단 강조 카드용: 이 사용자의 가장 큰 로스를 짚고 개선할
-- 구체적 행동 한 줄을 자유 텍스트 content와 별개의 구조화 필드로 제공한다
-- (자유 텍스트 안에 묻히면 카드로 뽑아 쓸 수 없다는 게 iOS 쪽 요청의 핵심).
--
-- time_breakdown과 동일한 이유로 생성 시점에 함께 저장한다: 캐시 재조회
-- (cached: true) 시에도 그날 텍스트가 서술하는 제안과 항상 일치해야 하고,
-- 채점할 목표/기록이 전혀 없어 제안을 만들 수 없었던 리포트는 null.
alter table ai_reports add column suggested_action text;
