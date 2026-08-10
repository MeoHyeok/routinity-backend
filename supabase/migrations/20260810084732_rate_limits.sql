-- 유저당 엔드포인트별 요청 횟수를 고정 윈도우로 세는 간단한 레이트리밋.
-- 별도 인프라(Redis 등) 없이 Postgres만으로 처리 — 서버 부담 최소화 원칙에 맞춤.

create table rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  window_start timestamptz not null,
  request_count int not null default 1,
  primary key (user_id, endpoint, window_start)
);

-- 클라이언트가 이 테이블에 직접 접근할 이유가 없으므로 RLS만 켜고 정책은 두지 않는다.
-- 쓰기/읽기는 아래 SECURITY DEFINER 함수를 통해서만 이뤄진다.
alter table rate_limits enable row level security;

-- p_max_requests개를 초과하면 false. search_path를 고정해 SECURITY DEFINER 함수의
-- search_path hijacking을 방지한다.
create or replace function check_rate_limit(
  p_user_id uuid,
  p_endpoint text,
  p_max_requests int,
  p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into rate_limits (user_id, endpoint, window_start, request_count)
  values (p_user_id, p_endpoint, v_window_start, 1)
  on conflict (user_id, endpoint, window_start)
  do update set request_count = rate_limits.request_count + 1
  returning request_count into v_count;

  return v_count <= p_max_requests;
end;
$$;

grant execute on function check_rate_limit(uuid, text, int, int) to authenticated;
