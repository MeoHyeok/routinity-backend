-- ai_reports_user_period_utc_day_idx enforced "one report per UTC calendar
-- day" at the DB level, but the app's "day" boundary (dateOnly/dayRange in
-- _shared/ai-report.ts) just switched from UTC to KST to fix a bug where a
-- Korean user's pre-9am-KST activity landed in the previous UTC day and
-- silently dropped out of their reports (see day-sessions.ts).
--
-- Left as-is, this index would go stale relative to the app: a UTC day and
-- a KST day don't line up, so two concurrent cache-miss requests near the
-- 09:00 KST rollover (one on either side of the UTC boundary) could both
-- insert — the exact double-generation race this index was added to
-- prevent (20260813060000), just shifted to a different boundary. Point the
-- index at the same KST day the app now uses.
drop index ai_reports_user_period_utc_day_idx;

create unique index ai_reports_user_period_kst_day_idx
  on ai_reports (user_id, period, (timezone('Asia/Seoul', created_at)::date));
