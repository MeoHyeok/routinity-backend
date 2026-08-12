# API 계약 — /logs, /goals, /scores, /reports/weekly

ROADMAP.md 2번 섹션의 초안을 실제 구현에 맞춰 확정한 문서. 이후 필드명/타입이 바뀌면 팀 채널에 즉시 공지.

## 공통

- **Base URL**: `https://noqvrfewkyfdrsoaszmz.supabase.co`
- **anon key** (Supabase Auth SDK 초기화용): `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vcXZyZmV3a3lmZHJzb2Fzem16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMzA3NDksImV4cCI6MjEwMTkwNjc0OX0.rAZiVgHR1FLs66wNEiW28WERlY1NZEi__Y3iGk_-1kk`
- **인증**: Supabase Auth로 로그인해서 받은 `access_token`을 모든 요청에 `Authorization: Bearer <access_token>` 헤더로 포함. 헤더가 없거나 유효하지 않으면 `401`.
- **에러 응답 형식**: `{ "error": "설명 문자열" }` (401은 플랫폼 레벨 응답이라 `{ "code": "...", "message": "..." }` 형식일 수 있음)
- **레이트리밋**: 유저별·엔드포인트별 1분 고정 윈도우. 초과 시 `429` + `{ "error": "rate limit exceeded, try again later" }`. 앱에서 429를 받으면 짧게 재시도하지 말고 사용자에게 "잠시 후 다시 시도" 정도로 안내 권장. 엔드포인트별 한도:
  - `/logs`: 60회/분
  - `/goals`: 20회/분
  - `/scores`: 60회/분
  - `/reports-weekly`: 10회/분 (하루 1회만 실제 생성되고 나머지는 캐시 응답이라 넉넉함)

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
- `target_value`: 문자열, 필수. `wake_time`/`study_duration`는 채점 로직이 파싱 가능한 형식을 서버에서 강제함 (그 외 target_type은 형식 제약 없이 임의 문자열 허용):
  - `wake_time`: `HH:MM` 24시간제 (예: `"07:00"`). 형식 아니면 400 `{ "error": "target_value must be HH:MM (24h)" }`
  - `study_duration`: 1 이상 정수 문자열, 분 단위 (예: `"60"`). 아니면 400 `{ "error": "target_value must be a positive integer (minutes)" }`

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

---

## GET /functions/v1/scores?date=YYYY-MM-DD

그날 목표 대비 점수 조회. 유저가 설정한 목표(`/goals`)와 그날 로그(`/logs`)를 비교해서 계산.

**요청 헤더**
```
Authorization: Bearer <access_token>
```

`date` 쿼리 파라미터 필수 (`YYYY-MM-DD`, UTC 기준).

**응답 200**
```json
{
  "date": "2026-08-10",
  "scores": [
    { "target_type": "wake_time", "target_value": "07:00", "actual_value": "06:50", "status": "achieved" },
    { "target_type": "study_duration", "target_value": "60", "actual_value": "30", "status": "not_achieved" }
  ]
}
```

- `status`: `"achieved" | "not_achieved" | "missing"`
  - `achieved`: 그날 실측값이 목표 충족
  - `not_achieved`: 로그는 있지만 목표 미달
  - `missing`: 그날 관련 로그가 아예 없음 (미달과 구분됨)
- `actual_value`: `missing`일 땐 항상 `null`
- 현재 채점 로직은 `target_type`이 `wake_time`(로그의 `wake` 타임스탬프, 목표보다 이르거나 같으면 achieved) / `study_duration`(그날 `study_start`~`study_end` 쌍의 총합(분), 목표 이상이면 achieved)일 때만 동작. 그 외 `target_type`으로 설정한 목표는 `scores` 배열에서 제외됨(아직 채점 규칙 없음)
- 목표를 하나도 설정 안 한 유저는 `scores: []`

## /scores 동작 확인 완료 (유닛 테스트 + 실제 요청)

- `supabase/functions/_shared/scoring.ts`의 순수 함수를 `npm test`로 검증: wake_time/study_duration 각각 achieved/not_achieved/missing 3케이스 + 여러 세션 합산 + 미지원 target_type 필터링, 총 8개 테스트 통과
- 실제 배포본에도 동일 시나리오로 확인: 인증 없음(401), `date` 누락(400), 로그 있는 날짜(achieved+not_achieved), 로그 없는 날짜(둘 다 missing), 목표 없는 유저는 빈 배열

---

## GET /functions/v1/reports-weekly

이번 주(오늘 포함 최근 7일, UTC 기준) 목표 달성 현황을 요약한 AI 리포트 조회. 조회 시점에 없으면 생성.

**요청 헤더**
```
Authorization: Bearer <access_token>
```

**응답 200 (신규 생성)**
```json
{
  "period": "weekly",
  "content": "이번 주 루티니티 리포트\n\n기상 목표: 7일 중 2일 달성, 1일 미달, 4일 기록 없음\n공부 시간 목표: 7일 중 1일 달성, 1일 미달, 5일 기록 없음",
  "cached": false,
  "generated_via": "claude" | "template"
}
```

**응답 200 (같은 날 재조회 — 캐시됨)**
```json
{ "period": "weekly", "content": "...", "cached": true }
```

- 하루에 한 번만 생성. 같은 UTC 날짜에 다시 GET하면 새로 생성하지 않고 `ai_reports`에 저장된 기존 리포트를 그대로 반환 (`cached: true`)
- 목표를 하나도 설정 안 했으면 "목표가 없다"는 안내 문구를 템플릿으로 반환
- **AI 생성 실패 시 자동으로 룰 기반 템플릿으로 폴백** (Claude API 키 미설정, 네트워크 오류, API 에러, refusal 전부 포함) — 로드맵 리스크 대응 그대로 구현. `generated_via`로 어느 경로였는지 확인 가능
- 리포트 생성에 사용하는 모델: `claude-haiku-4-5-20251001`

## /reports/weekly 동작 확인 완료

- 인증 없는 요청 → 401
- 실제 목표+로그 데이터로 7일치 집계 정확성 확인 (기상/공부 각각 achieved/not_achieved/missing 카운트가 실제 로그와 일치)
- `ANTHROPIC_API_KEY` 미설정 상태에서 템플릿 폴백 정상 동작 확인 (`generated_via: "template"`)
- 같은 날 재조회 시 캐시 반환 확인
- 목표 없는 유저는 안내 템플릿 반환
- 다른 유저의 리포트는 안 보임 (RLS)

## 레이트리밋/환경변수 점검 완료 (Day 13-14 착수분)

- **레이트리밋**: `rate_limits` 테이블 + `check_rate_limit()` Postgres 함수(고정 1분 윈도우)를 4개 함수 전부에 연결. 실제 요청으로 검증: DB 함수 자체(작은 한도로 직접 RPC 호출해 3회 통과 후 4회째 차단 확인), `/reports-weekly` 실제 엔드포인트에서 10회 통과 후 11회째 `429` 확인(두 번 재현), 유저별 독립적으로 적용되는 것도 확인
- **환경변수**: `.env`/`.env.local`이 git에 커밋된 적 없음, git history 전체에 service_role/Anthropic 키 노출 없음(anon key만 있고 이건 iOS 공유용으로 의도된 것), 함수 코드에 하드코딩된 시크릿 없음, Supabase 프로젝트 시크릿은 플랫폼 자동 주입분만 존재 확인. `ANTHROPIC_API_KEY`는 여전히 미설정 상태(템플릿 폴백으로 정상 동작 중이며, 실제 Claude 응답을 보려면 별도로 시크릿 등록 필요)

## 구현 완료

로드맵의 4개 엔드포인트(`/logs`, `/goals`, `/scores`, `/reports/weekly`) 모두 구현/배포/테스트 완료. 레이트리밋·환경변수 점검도 완료. 남은 건 iOS팀과의 통합 테스트와 프로덕션 배포 (로드맵 11-14일차).
