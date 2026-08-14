-- 우선순위 5(월간 리포트) 추가를 위해 ai_reports.period가 'monthly'도 받도록
-- 확장. 캐싱(하루 1회 생성)은 (user_id, period, UTC 날짜) 유니크 인덱스가
-- period 값과 무관하게 이미 강제하고 있어서 별도 변경 불필요 — check
-- 제약만 넓히면 된다.
alter table ai_reports drop constraint ai_reports_period_check;
alter table ai_reports add constraint ai_reports_period_check
  check (period in ('daily', 'weekly', 'monthly'));
