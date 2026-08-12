-- 보안 수정: check_rate_limit(p_user_id, ...)가 호출자가 넘긴 p_user_id를
-- 그대로 믿고 사용해서, 인증만 된 유저라면 누구든 임의의 다른 user_id로
-- RPC를 직접 호출해 그 유저의 레이트리밋 카운터를 소진시킬 수 있었다
-- (해당 유저 서비스 거부/DoS). p_user_id 파라미터를 제거하고 함수 내부에서
-- auth.uid()로 호출자 본인만 대상으로 삼도록 고정한다.

drop function if exists check_rate_limit(uuid, text, int, int);

create or replace function check_rate_limit(
  p_endpoint text,
  p_max_requests int,
  p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_window_start timestamptz;
  v_count int;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into rate_limits (user_id, endpoint, window_start, request_count)
  values (v_user_id, p_endpoint, v_window_start, 1)
  on conflict (user_id, endpoint, window_start)
  do update set request_count = rate_limits.request_count + 1
  returning request_count into v_count;

  return v_count <= p_max_requests;
end;
$$;

grant execute on function check_rate_limit(text, int, int) to authenticated;
