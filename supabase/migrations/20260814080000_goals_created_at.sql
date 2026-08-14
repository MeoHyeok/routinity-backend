-- /insights(28일 롤링 윈도우 요일별 평균/트렌드)를 붙이면서 발견한 문제 수정:
-- goals에는 updated_at만 있고 "이 목표를 최초로 언제 설정했는지"를 알 방법이
-- 없었다. 그래서 지금 목표가 있으면 그 목표를 세우기 이전 과거 날짜까지도
-- "그날 기록 없음 = 0점"으로 집계에 포함되어, 막 가입한 유저의 지난 27일이
-- 전부 0점으로 잡히는 등 통계가 왜곡될 수 있었다. created_at을 추가해서
-- /insights가 목표가 실제로 존재했던 날짜부터만 집계하도록 한다.
--
-- upsert(POST /goals)는 이 컬럼을 SET 절에 넣지 않으므로 최초 INSERT 시
-- DEFAULT now()가 적용되고, 이후 재요청(업데이트)에는 값이 바뀌지 않는다.
alter table goals add column created_at timestamptz not null default now();
