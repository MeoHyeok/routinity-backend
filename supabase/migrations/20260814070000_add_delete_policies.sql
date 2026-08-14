-- iOS 팀 요청: 잘못 기록한 로그 삭제(DELETE /logs), 목표 추적 중단(DELETE /goals) 지원.
-- 기존에는 select/insert(/update, goals만) 정책만 있고 delete 정책이 없어서
-- RLS가 소유자의 삭제 요청까지 막고 있었다.

create policy "routine_logs_delete_own" on routine_logs
  for delete using (auth.uid() = user_id);

create policy "goals_delete_own" on goals
  for delete using (auth.uid() = user_id);
