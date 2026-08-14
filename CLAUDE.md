# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The ROADMAP is fully complete: all four endpoints are implemented, deployed, and tested; the Day 13-14 security/ops checklist (RLS, rate limiting, env/secret hygiene, production deploy, basic logging/monitoring) is done; and Day 11-12 end-to-end integration testing with the iOS team is done (`/goals` upsert, all three `/scores` statuses, `/reports-weekly` generation+cache all verified live in the app, no bugs found). `ROADMAP.md` is still the source of the original plan and day-by-day timeline; `docs/api-contract.md` is now the authoritative, implementation-accurate API reference (finalized field names/types, confirmed behaviors, verification notes) — prefer it over the ROADMAP's draft endpoint table when the two disagree. Production deploy: the project is a hackathon demo, so the Supabase project already in use (`noqvrfewkyfdrsoaszmz`, the one `docs/api-contract.md` gives the iOS team) is confirmed as production; there is no separate prod project to migrate to.

## Stack

- **Backend platform**: Supabase (Postgres + Auth + Edge Functions, TypeScript/Deno)
- **AI integration**: Anthropic Claude API (`claude-haiku-4-5-20251001`) for the daily and weekly AI feedback reports (`/reports-daily`, `/reports-weekly`), with an automatic rule-based template fallback (missing API key, network error, API error, or refusal all fall back)
- Local dev/build tooling: `package.json` at repo root, `npm test` runs the unit tests under `supabase/functions/_shared/*.test.ts` (Node's built-in test runner)
- If the stack changes, update this section and the "스택 가정" line in `ROADMAP.md` — the roadmap explicitly calls out that line as the one to swap.

## Architecture

### Data model
Four core tables, all keyed off `user_id` referencing Supabase Auth's `users` (migrations under `supabase/migrations/`):
- `routine_logs` — event log of routine actions (`type`: `wake | meal | study_start | study_end`) with a `timestamp`. This is the raw input everything else derives from. Deletable by owner (`DELETE /logs?id=`).
- `goals` — per-user target values (`target_type`: `wake_time | study_duration`, etc., not a fixed enum) that logs are scored against. Upsert semantics: at most one row per `(user_id, target_type)`. Deletable by owner (`DELETE /goals?target_type=`).
- `ai_reports` — generated daily/weekly AI report text, derived from `routine_logs` + `goals`. Both periods are generated at most once per UTC day and cached (`generated_via: "claude" | "template"`), enforced by a shared `(user_id, period, UTC day)` unique index that predates the `daily` period actually being used.
- `rate_limits` — added later (Day 13-14 work) to back the fixed 1-minute-window rate limiter; not part of the original four-table plan.

All four tables have RLS enabled with owner-only policies (`create policy ..._select_own` / `..._insert_own` etc. in `supabase/migrations/20260810062033_init_schema.sql`, `20260810084732_rate_limits.sql`, and `20260814070000_add_delete_policies.sql` for the delete policies) — a user can never see or delete another user's rows.

### API surface
Edge Functions are served under `/functions/v1/<name>` (Supabase's standard prefix), not the flat `/logs`-style paths sketched in the ROADMAP draft: `/functions/v1/logs`, `/functions/v1/goals`, `/functions/v1/scores`, `/functions/v1/reports-weekly`, `/functions/v1/reports-daily` (the last one added 2026-08-14, not in the original ROADMAP draft — see AI feedback section). `/logs` and `/goals` also support `DELETE` (added 2026-08-14 at the iOS team's request — not in the original ROADMAP draft) for removing a mis-logged entry or dropping a tracked goal entirely. Auth is a required `Authorization: Bearer <access_token>` header (401 if missing/invalid); errors are `{ "error": "..." }`. See `docs/api-contract.md` for full request/response shapes — it is the field-name/type source of truth for the iOS team, finalized from the ROADMAP draft (e.g. log `id` is a uuid, not the draft's `log_abc123`). Per the roadmap, any further field/type change must be announced to the team channel immediately.

### Scoring logic
`supabase/functions/_shared/scoring.ts` is a pure-function layer that compares `routine_logs` against `goals` to produce a per-day score with three outcome cases: achieved / not_achieved / missing. Currently implements rules for `wake_time` and `study_duration` only; other `target_type` values are silently excluded from `/scores` output until rules exist for them. `computeDailyScore` (added 2026-08-14, design confirmed with the iOS team) rolls a day's `ScoreEntry[]` into one 0-100 `daily_score` on the same response — `null` when there's nothing to score. Uses per-goal partial credit rather than a binary achieved-count ratio (which only ever landed on 0/50/100 with just 1-2 scorable goals): `achieved` = 1, `missing` = 0 (no data to judge closeness), `study_duration` `not_achieved` = actual/target minutes ratio, `wake_time` `not_achieved` = linear decay over a 120-minute lateness window. Covered by unit tests (16 cases across `computeScores` + `computeDailyScore`) plus live-endpoint verification.

### AI feedback (`/reports-weekly`, `/reports-daily`)
Was the highest-risk component on the timeline; now implemented with the planned fallback: rule-based template report ships whenever Claude generation isn't available or fails, with real LLM generation (`claude-haiku-4-5-20251001`) used when it succeeds. Reports are generated at most once per UTC day and cached (`cached: true` on repeat calls same-day). `/reports-daily` (added 2026-08-14, priority #2 in the post-launch feature list, response shape confirmed with the iOS team) is the same policy scoped to today instead of the last 7 days — its content narrates that day's `daily_score` and per-goal status. The Claude API call and UTC-day-range helpers live in `_shared/ai-report.ts`, shared by both functions to avoid duplicating that logic.

### Notification philosophy
Notifications are deliberately pushed to the iOS client to compute locally rather than being server-driven, to keep server load down. Don't build server-side notification scheduling unless this decision is revisited.

## Priorities (from ROADMAP.md)

1. ~~The Day 3-4 API contract (`/logs` CRUD) is the most critical deliverable~~ — shipped; `docs/api-contract.md` is the finalized version the iOS team builds against.
2. ~~AI feedback (Day 8-10) is the most likely slip point~~ — shipped with the rule-based template fallback as planned.
3. Push notification logic belongs on iOS, not the backend.
4. Data-asset/analytics work (referred to as "4단계" in the roadmap) is explicitly out of scope for this sprint.
5. All roadmap phases complete, including Day 11-12 iOS integration testing and the Day 13-14 tail end (production deploy, basic logging/monitoring) — see Project status and Security/ops checklist.

## Security/ops checklist

Per the roadmap's final phase (Day 13-14):
- [x] Row Level Security (RLS) policies on all tables (`routine_logs`, `goals`, `ai_reports`, `rate_limits`)
- [x] API rate limiting — per-user, per-endpoint, fixed 1-minute window via a `check_rate_limit()` Postgres function; limits documented per endpoint in `docs/api-contract.md`
- [x] Separated environment/secret configuration (`.env`, `.env.example`); verified no secrets ever committed to git history and no hardcoded secrets in function code. `ANTHROPIC_API_KEY` is still unset in this environment (template fallback covers it) — set it to exercise real Claude report generation.
- [x] Production deploy — confirmed 2026-08-14: `noqvrfewkyfdrsoaszmz` is the production project (hackathon demo, no separate prod project planned); migrations and all 4 Edge Functions verified up to date on it
- [x] Basic logging/monitoring hookup — structured per-request log line (endpoint/method/status/latency) added to every function (`supabase/functions/_shared/log.ts`), unit-tested, deployed to production
