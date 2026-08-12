-- 보안/보완 수정 (코드 리뷰):
--
-- 1) goals.target_type/target_value는 자유 문자열이라(향후 새 목표 타입을 마이그레이션
--    없이 추가하기 위한 의도적 설계) 길이 제한이 전혀 없었다. Edge Function에서
--    최대 길이를 검증하도록 고쳤지만, DB 레벨에도 동일한 상한을 걸어 애플리케이션
--    검증을 우회하는 경로(직접 DB 접근, 검증 로직 회귀 등)로부터 방어한다.
--
-- 2) ai_reports는 "UTC 하루에 한 번만 생성/캐시"가 설계 의도(CLAUDE.md)이지만 이를
--    강제하는 제약이 없었다. 동시에 두 요청이 캐시 미스를 보고 동시에 Claude를
--    호출/삽입하면 같은 날 리포트가 중복 생성될 수 있었다(비용 이중 지출 +
--    "하루 한 번 캐시" 불변식 깨짐). (user_id, period, UTC 날짜) unique index로
--    DB 레벨에서 강제한다.

alter table goals
  add constraint goals_target_type_length check (char_length(target_type) <= 50);

alter table goals
  add constraint goals_target_value_length check (char_length(target_value) <= 200);

create unique index ai_reports_user_period_utc_day_idx
  on ai_reports (user_id, period, (timezone('utc', created_at)::date));
