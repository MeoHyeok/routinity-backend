# API 계약 — /logs, /goals

ROADMAP.md 2번 섹션의 초안을 실제 구현에 맞춰 확정한 문서. 이후 필드명/타입이 바뀌면 팀 채널에 즉시 공지.

## 공통

- **Base URL**: `https://noqvrfewkyfdrsoaszmz.supabase.co`
- **anon key** (Supabase Auth SDK 초기화용): `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vcXZyZmV3a3lmZHJzb2Fzem16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMzA3NDksImV4cCI6MjEwMTkwNjc0OX0.rAZiVgHR1FLs66wNEiW28WERlY1NZEi__Y3iGk_-1kk`
- **인증**: Supabase Auth로 로그인해서 받은 `access_token`을 모든 요청에 `Authorization: Bearer <access_token>` 헤더로 포함. 헤더가 없거나 유효하지 않으면 `401`.
- **에러 응답 형식**: `{ "error": "설명 문자열" }` (401은 플랫폼 레벨 응답이라 `{ "code": "...", "message": "..." }` 형식일 수 있음)

## POST /functions/v1/logs

이벤트 기록 (기상/식사/공부 시작·종료)

**요청 헤더**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**요청 바디**
```json
{ "type": "study_start", "timestamp": "2026-08-10T09:00:00Z" }
```

- `type`: `"wake" | "meal" | "study_start" | "study_end"` (필수, 이 외 값이면 400)
- `timestamp`: ISO 8601 문자열 (필수, 파싱 불가하면 400)

**응답 201**
```json
{
  "id": "d5d2610c-edc6-445d-bece-c024b36f9218",
  "type": "study_start",
  "timestamp": "2026-08-10T09:00:00+00:00",
  "created_at": "2026-08-10T07:43:47.276861+00:00"
}
```

`id`는 uuid. ROADMAP 초안의 `log_abc123` 형식이 아니라 uuid로 확정.

## GET /functions/v1/logs?date=YYYY-MM-DD

특정 날짜(UTC 기준)의 로그 조회.

**요청 헤더**
```
Authorization: Bearer <access_token>
```

`date` 쿼리 파라미터 필수 (`YYYY-MM-DD` 형식 아니면 400).

**응답 200**
```json
[
  { "id": "...", "type": "study_start", "timestamp": "2026-08-10T09:00:00+00:00", "created_at": "..." }
]
```

시간순 정렬. 해당 날짜에 로그가 없으면 빈 배열.

## /logs 동작 확인 완료

- 인증 없는 요청 → 401
- 정상 POST → 201, DB에 저장 확인
- 잘못된 `type` → 400
- 날짜 필터링 정상 동작
- 다른 유저의 로그는 절대 보이지 않음 (RLS로 서버에서 강제)

---

## POST /functions/v1/goals

목표(대조군) 설정. **upsert 동작** — 같은 `target_type`으로 다시 POST하면 새로 생기지 않고 기존 값이 갱신됨 (유저당 `target_type`별로 항상 최대 1개).

**요청 헤더**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**요청 바디**
```json
{ "target_type": "wake_time", "target_value": "07:00" }
```

- `target_type`: 문자열, 필수. `wake_time`, `study_duration` 등 — 고정 enum 아님, 새로운 타입 자유롭게 추가 가능
- `target_value`: 문자열, 필수 (숫자/시간 등 어떤 값이든 문자열로 전달)

**응답 200** (생성이든 갱신이든 200 — "지금 이 목표값은 이것"이라는 현재 상태 응답이라 201/200 구분 안 함)
```json
{
  "id": "3d6b0d3c-178d-45c0-bfa9-80795e9dc16d",
  "target_type": "wake_time",
  "target_value": "06:30",
  "updated_at": "2026-08-10T08:01:19.828+00:00"
}
```

## GET /functions/v1/goals

로그인한 유저의 모든 목표 조회.

**요청 헤더**
```
Authorization: Bearer <access_token>
```

**응답 200**
```json
[
  { "id": "...", "target_type": "study_duration", "target_value": "120", "updated_at": "..." },
  { "id": "...", "target_type": "wake_time", "target_value": "06:30", "updated_at": "..." }
]
```

`target_type` 기준 정렬. 설정한 목표가 없으면 빈 배열.

## /goals 동작 확인 완료

- 인증 없는 요청 → 401
- 신규 target_type POST → 200, 새 row 생성
- 같은 target_type 재 POST → 200, 같은 id 유지하며 target_value/updated_at만 갱신 (upsert 확인)
- 필수 필드 누락 → 400
- GET이 해당 유저의 모든 목표를 배열로 반환
- 다른 유저의 목표는 절대 보이지 않음 (RLS)

## 아직 구현 안 됨 (Day 6 이후)

`/scores`, `/reports/weekly`
