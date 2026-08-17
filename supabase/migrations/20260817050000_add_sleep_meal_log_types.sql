-- 홈 화면 로그 버튼 4개(기상/식사/공부시작/공부종료) -> 3개(기상/식사/공부)로
-- 개편하면서 기능 확장: 취침(sleep), 식사 시작/종료(meal_start/meal_end)를
-- 새 타입으로 추가. 하루 활동 시간(기상~취침)에서 식사·공부를 뺀 나머지를
-- "휴식 시간"으로 계산해 리포트에 반영하기 위함(computeDayBreakdown).
--
-- 기존 'meal'은 DB 제약에는 남겨서 과거 기록을 그대로 읽을 수 있게 하되,
-- Edge Function의 신규 입력 검증(ALLOWED_TYPES)에서는 제외해 새로 저장되지
-- 않도록 한다 — 데이터 백필/마이그레이션 없이 자연스럽게 대체.
alter table routine_logs drop constraint routine_logs_type_check;
alter table routine_logs add constraint routine_logs_type_check
  check (type in ('wake', 'sleep', 'meal', 'meal_start', 'meal_end', 'study_start', 'study_end'));
