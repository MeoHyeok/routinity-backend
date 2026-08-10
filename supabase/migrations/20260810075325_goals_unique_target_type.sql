-- 사용자당 target_type별로 목표는 하나만 존재하도록 강제.
-- POST /goals가 upsert(있으면 갱신, 없으면 생성)로 동작하기 위한 전제 조건.
alter table goals add constraint goals_user_id_target_type_key unique (user_id, target_type);
