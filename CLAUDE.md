# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository currently contains only `ROADMAP.md` — no source code, package manifest, or git repo has been initialized yet. The roadmap is a 2-week sprint plan for the backend of "루티니티" (Routinity), a routine-tracking app with an iOS frontend developed in parallel by a separate team. Treat `ROADMAP.md` as the authoritative spec until real code exists; update this file once the project scaffold (framework, build tooling, tests) is in place.

## Stack (as planned)

- **Backend platform**: Supabase (Postgres + Auth + Edge Functions, TypeScript)
- **AI integration**: Anthropic Claude API, used for the weekly AI feedback report (`/reports/weekly`)
- If the stack changes, update this section and the "스택 가정" line in `ROADMAP.md` — the roadmap explicitly calls out that line as the one to swap.

## Architecture (as planned)

### Data model
Four core tables, all keyed off `user_id` referencing Supabase Auth's `users`:
- `routine_logs` — event log of routine actions (`type`: `wake | meal | study_start | study_end`) with a `timestamp`. This is the raw input everything else derives from.
- `goals` — per-user target values (`target_type`: `wake_time | study_duration`, etc.) that logs are scored against.
- `ai_reports` — generated daily/weekly AI report text, derived from `routine_logs` + `goals`.

### API surface
REST-style endpoints under a flat namespace (`/logs`, `/goals`, `/scores`, `/reports/weekly`). The API contract (field names/types) is a hard sync point with the iOS team — per the roadmap, once the contract ships (Day 3-4), any field/type change must be announced to the team channel immediately, since iOS development proceeds in parallel against it.

### Scoring logic
A distinct layer that compares `routine_logs` against `goals` to produce a per-day score with three outcome cases: achieved / not achieved / missing. This sits between raw log ingestion and the AI report generation.

### AI feedback (`/reports/weekly`)
Highest-risk component on the timeline. The fallback plan if Claude API integration lags: ship a rule-based template report first, then swap in real LLM generation later. Don't block the sprint on this endpoint being LLM-backed from day one.

### Notification philosophy
Notifications are deliberately pushed to the iOS client to compute locally rather than being server-driven, to keep server load down. Don't build server-side notification scheduling unless this decision is revisited.

## Priorities (from ROADMAP.md)

1. The Day 3-4 API contract (`/logs` CRUD) is the most critical deliverable — the iOS team is blocked end-to-end until it ships.
2. AI feedback (Day 8-10) is the most likely slip point; the rule-based template fallback exists specifically to de-risk this.
3. Push notification logic belongs on iOS, not the backend.
4. Data-asset/analytics work (referred to as "4단계" in the roadmap) is explicitly out of scope for this sprint.

## Security/ops checklist (not yet implemented)

Per the roadmap's final phase (Day 13-14), these are required before production deploy: Row Level Security (RLS) policies on all tables, API rate limiting, and separated environment/secret configuration (`.env`).
