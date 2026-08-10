-- 루티니티 초기 스키마 (ROADMAP.md 1단계)
-- users 테이블은 별도로 만들지 않고 Supabase Auth의 auth.users를 그대로 참조한다.

create table routine_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('wake', 'meal', 'study_start', 'study_end')),
  timestamp timestamptz not null,
  created_at timestamptz not null default now()
);

create index routine_logs_user_id_timestamp_idx on routine_logs (user_id, timestamp);

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null,
  target_value text not null,
  updated_at timestamptz not null default now()
);

create index goals_user_id_idx on goals (user_id);

create table ai_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null check (period in ('daily', 'weekly')),
  content text not null,
  created_at timestamptz not null default now()
);

create index ai_reports_user_id_period_idx on ai_reports (user_id, period, created_at desc);

-- RLS: 각 사용자는 자기 소유 행만 접근. ai_reports는 서버(service role)가 생성하므로
-- 클라이언트에는 조회 권한만 부여한다.

alter table routine_logs enable row level security;
alter table goals enable row level security;
alter table ai_reports enable row level security;

create policy "routine_logs_select_own" on routine_logs
  for select using (auth.uid() = user_id);

create policy "routine_logs_insert_own" on routine_logs
  for insert with check (auth.uid() = user_id);

create policy "goals_select_own" on goals
  for select using (auth.uid() = user_id);

create policy "goals_insert_own" on goals
  for insert with check (auth.uid() = user_id);

create policy "goals_update_own" on goals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "ai_reports_select_own" on ai_reports
  for select using (auth.uid() = user_id);
