# API 계약 — /logs, /goals, /scores, /reports/weekly, /reports/daily, /reports/monthly, /insights

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
  - `/reports-daily`: 10회/분 (동일한 이유)
  - `/reports-monthly`: 10회/분 (동일한 이유)
  - `/insights`: 20회/분

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

## DELETE /functions/v1/logs?id=&lt;uuid&gt;

잘못 기록한 로그 삭제. `id`는 `POST`/`GET /logs` 응답의 `id` 값(uuid).

**요청 헤더**
```
Authorization: Bearer <access_token>
```

- `id` 쿼리 파라미터 필수 (uuid 형식 아니면 400)
- 삭제 성공 시 **204 No Content** (바디 없음)
- 존재하지 않거나 본인 소유가 아니면 **404** `{ "error": "log not found" }` — 다른 유저의 로그 id를 넣어도 RLS로 인해 항상 404 (존재 여부 자체를 노출하지 않음)

## /logs 동작 확인 완료

- 인증 없는 요청 → 401
- 정상 POST → 201, DB에 저장 확인
- 잘못된 `type` → 400
- 날짜 필터링 정상 동작
- 다른 유저의 로그는 절대 보이지 않음 (RLS로 서버에서 강제)
- `DELETE`: `id` 없음 → 400 / 존재하지 않는 id → 404 / 본인 로그 삭제 → 204 후 재조회 시 사라짐 확인 / 다른 유저가 내 로그 id로 삭제 시도 → 404(성공 안 함, RLS 확인) / 삭제된 id로 재삭제 시도 → 404

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

## DELETE /functions/v1/goals?target_type=&lt;string&gt;

목표 추적 중단(완전 삭제). `target_value`만 덮어쓰는 POST와 달리 row 자체를 지운다 — 삭제 후 같은 target_type으로 다시 POST하면 새 id로 새로 생성됨.

**요청 헤더**
```
Authorization: Bearer <access_token>
```

- `target_type` 쿼리 파라미터 필수 (없으면 400)
- 삭제 성공 시 **204 No Content** (바디 없음)
- 해당 target_type의 목표가 없으면 **404** `{ "error": "goal not found" }` (다른 유저 소유인 경우도 RLS로 동일하게 404)

## /goals 동작 확인 완료

- 인증 없는 요청 → 401
- 신규 target_type POST → 200, 새 row 생성
- 같은 target_type 재 POST → 200, 같은 id 유지하며 target_value/updated_at만 갱신 (upsert 확인)
- 필수 필드 누락 → 400
- GET이 해당 유저의 모든 목표를 배열로 반환
- 다른 유저의 목표는 절대 보이지 않음 (RLS)
- `DELETE`: `target_type` 없음 → 400 / 없는 target_type → 404 / 존재하는 목표 삭제 → 204 후 재조회 시 사라짐 확인

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
  "daily_score": 50,
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
- 목표를 하나도 설정 안 한 유저는 `scores: []`, `daily_score: null`
- **`date`는 과거 아무 날짜나 조회 가능** (미래 날짜 제한 없음). **2026-08-14 수정**: 조회하는 `date`가 목표를 실제로 설정하기 이전이면, 그 목표는 `scores` 배열에서 제외됨(과거엔 현재 목표가 그 이전 날짜까지 소급 적용돼서 `missing`으로 잘못 표시되던 버그가 있었음 — `/insights`와 동일한 `goalsExistingBy` 규칙 적용)
- **`daily_score`** (2026-08-14 추가, 같은 날 부분점수 방식으로 개선): 그날 채점 가능한 목표들의 "목표별 근접도(0~1)"를 평균 내서 0~100 정수로 변환 — `round(목표별 credit 합 / 목표 개수 × 100)`. 목표별 credit:
  - `achieved` → 항상 1 (초과 달성해도 보너스 없음)
  - `missing` → 항상 0 (근접했는지 판단할 데이터 자체가 없음)
  - `study_duration`의 `not_achieved` → `실제 분 / 목표 분` 비율 (예: 60분 목표에 30분 → 0.5)
  - `wake_time`의 `not_achieved` → 목표시간보다 늦은 정도에 비례해 감소, 120분(2시간) 이상 늦으면 0
  - 채점 가능한 목표가 하나도 없으면(=`scores: []`) `null`
  - 목표가 1~2개뿐이라도 부분점수 덕분에 0/50/100처럼 딱 떨어지지 않고 임의의 정수(예: 58)로 나올 수 있음

## /scores 동작 확인 완료 (유닛 테스트 + 실제 요청)

- `supabase/functions/_shared/scoring.ts`의 순수 함수를 `npm test`로 검증: wake_time/study_duration 각각 achieved/not_achieved/missing 3케이스 + 여러 세션 합산 + 미지원 target_type 필터링, 총 8개 테스트 통과
- 실제 배포본에도 동일 시나리오로 확인: 인증 없음(401), `date` 누락(400), 로그 있는 날짜(achieved+not_achieved), 로그 없는 날짜(둘 다 missing), 목표 없는 유저는 빈 배열
- `daily_score`: `computeDailyScore` 유닛 테스트 8개(목표 없음→null / 전부 달성→100 / missing→0 / study_duration 부분점수 / wake_time 부분점수(시간 비례 감소) / wake_time 유예시간 초과 시 0 / 혼합 케이스 반올림) + 실제 배포본에서 목표 없음(`null`) → 전부 missing(`0`) → 1개만 달성(`50`) → 전부 달성(`100`) → 부분점수 혼합 케이스(`58`, 0/50/100 아닌 임의 정수 확인) 순서로 라이브 확인

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
- **패턴 반영** (2026-08-14 추가): `/insights`와 동일한 28일 데이터로 계산한 요일별 최고/최악, 최근 트렌드가 있으면 리포트 본문에 "패턴 분석" 섹션으로 덧붙음(템플릿) / Claude 프롬프트에 추가 컨텍스트로 포함(AI 생성). 패턴 데이터가 없으면(계산 실패 또는 아직 데이터 부족) 그냥 생략 — 응답 필드/포맷은 변화 없음, `content` 텍스트 내용만 더 풍부해짐
- **"N일 중" 은 목표별로 실제 채점된 날짜 수** (2026-08-14 수정): 항상 7이 아니라 `달성+미달+기록없음` 합. 목표를 이번 주 중간에 설정했으면 그 이전 날짜는 아예 집계에서 빠지고(`/scores`와 동일한 `goalsExistingBy` 규칙), "N일 중" 숫자도 그만큼 줄어듦 — 목표 설정 첫날 조회하면 "1일 중 0일 달성..." 처럼 나옴

## /reports/weekly 동작 확인 완료

- 인증 없는 요청 → 401
- 실제 목표+로그 데이터로 7일치 집계 정확성 확인 (기상/공부 각각 achieved/not_achieved/missing 카운트가 실제 로그와 일치)
- `ANTHROPIC_API_KEY` 미설정 상태에서 템플릿 폴백 정상 동작 확인 (`generated_via: "template"`)
- 같은 날 재조회 시 캐시 반환 확인
- 목표 없는 유저는 안내 템플릿 반환
- 다른 유저의 리포트는 안 보임 (RLS)
- 패턴 반영: 실제 배포본에서 여러 주에 걸친 로그로 "패턴 분석" 섹션이 정확한 요일/점수/트렌드로 렌더링되는 것 확인
- 목표 소급 적용 수정: 테스트 계정으로 목표를 오늘 막 설정 → "1일 중 0일 달성, 0일 미달, 1일 기록 없음"으로 정확히 나오는 것 확인 (수정 전엔 "7일 중 0일 달성, 0일 미달, 1일 기록 없음"으로 나머지 6일이 실제로는 존재하지도 않았던 목표의 미기록으로 잘못 집계됐음)

---

## GET /functions/v1/reports-daily

오늘(UTC 기준) 목표 달성 현황을 요약한 AI 일간 리포트 조회. 조회 시점에 없으면 생성. `/reports-weekly`와 동일한 정책(하루 1회 생성+캐시, AI 실패 시 템플릿 폴백)을 오늘 하루 범위로 적용한 것 — `date` 쿼리 파라미터는 받지 않고 항상 "오늘" 기준.

**요청 헤더**
```
Authorization: Bearer <access_token>
```

**응답 200 (신규 생성)**
```json
{
  "period": "daily",
  "date": "2026-08-14",
  "content": "오늘의 루티니티 리포트\n\n오늘의 루틴 점수: 75점\n\n기상 목표: 목표 07:00, 실제 06:00 — 달성\n공부 시간 목표: 목표 60, 실제 30 — 미달성",
  "cached": false,
  "generated_via": "claude" | "template"
}
```

**응답 200 (같은 날 재조회 — 캐시됨)**
```json
{ "period": "daily", "date": "2026-08-14", "content": "...", "cached": true }
```

- `date`는 이 리포트가 어느 날짜 기준인지 (weekly엔 없는 필드, daily는 하루 단위라 명시)
- 하루에 한 번만 생성 — weekly와 같은 `ai_reports` 유니크 인덱스(`user_id, period, UTC 날짜`)로 DB 레벨에서 강제됨. 같은 유저가 같은 날 다시 GET하면 `cached: true`
- 목표를 하나도 설정 안 했으면 "목표가 없다"는 안내 문구 템플릿 반환 (weekly와 동일 패턴)
- AI 생성 실패 시 자동 템플릿 폴백, `generated_via`로 경로 확인 가능 — weekly와 동일 로직 공유(`_shared/ai-report.ts`)
- 리포트 본문에 그날의 `daily_score`(`/scores`와 동일한 계산)와 목표별 상태를 함께 서술
- **패턴 반영** (2026-08-14 추가): weekly와 동일하게 `/insights` 패턴(요일별 최고/최악, 최근 트렌드)이 있으면 "패턴 분석" 섹션으로 덧붙음

## /reports/daily 동작 확인 완료

- 목표 없는 유저 → 안내 템플릿, `cached: false`
- 같은 날 재조회 → `cached: true`, 목표를 나중에 추가해도 그날 캐시된 내용 그대로 반환 확인(의도된 동작, weekly와 동일)
- 패턴 반영: 실제 배포본에서 여러 주에 걸친 로그로 오늘 리포트에도 "패턴 분석" 섹션이 정확하게 붙는 것 확인
- 목표+로그 있는 유저 → `daily_score`와 목표별 달성/미달성 내용이 실제 데이터와 일치 확인 (예: 기상 달성 + 공부 30/60분 미달 → `daily_score: 75`)
- `/reports-weekly`를 `_shared/ai-report.ts`(Claude 호출, 날짜 계산)로 리팩터링한 뒤에도 기존 응답이 그대로 나오는 것 회귀 확인

---

## GET /functions/v1/reports-monthly

최근 30일(캘린더 월이 아니라 롤링 윈도우, UTC 기준) 목표 달성 현황을 요약한 AI 월간 리포트 조회. weekly/daily와 동일하게 조회 시점에 없으면 생성.

**요청 헤더**
```
Authorization: Bearer <access_token>
```

**응답 200 (신규 생성)**
```json
{
  "period": "monthly",
  "date_range": { "from": "2026-07-16", "to": "2026-08-14" },
  "content": "최근 한 달 루티니티 리포트\n\n기상 목표: 최근 30일 중 7일 달성, 3일 미달, 20일 기록 없음\n\n패턴 분석\n금요일에 가장 잘 지키고(평균 50점), 화요일에 가장 많이 놓치는 편이에요(평균 0점).\n최근 일주일 평균이 지난주보다 올랐어요 (29점 → 43점).",
  "cached": false,
  "generated_via": "claude" | "template"
}
```

**응답 200 (같은 날 재조회 — 캐시됨)**
```json
{ "period": "monthly", "date_range": { "from": "2026-07-16", "to": "2026-08-14" }, "content": "...", "cached": true }
```

- **캘린더 월이 아니라 최근 30일 롤링 윈도우** — `/reports-weekly`(최근 7일)/`/reports-daily`(오늘)와 일관되게, 가입한 지 한 달이 안 된 유저에게도 어색한 "이번 달 1~14일치만" 같은 리포트가 아니라 항상 꽉 찬 30일 기준으로 나옴
- `date_range`는 `/insights`와 같은 필드명(`from`/`to`)
- 하루에 한 번만 생성 — weekly/daily와 같은 `ai_reports` 유니크 인덱스로 DB 레벨에서 강제. 같은 유저가 같은 날 다시 GET하면 `cached: true`
- 목표를 하나도 설정 안 했으면 안내 문구 템플릿 반환 (weekly/daily와 동일 패턴)
- AI 생성 실패 시 자동 템플릿 폴백, `generated_via`로 경로 확인 가능
- `/insights`와 동일한 패턴(요일별 최고/최악, 최근 트렌드) 반영 — 있으면 "패턴 분석" 섹션 포함
- **"최근 N일 중"은 목표별로 실제 채점된 날짜 수** (2026-08-14 수정, `/reports-weekly`와 동일): 목표 설정 이전 날짜는 `goalsExistingBy` 규칙으로 집계에서 제외되고, 그만큼 "N일" 숫자도 줄어듦 — 항상 30이 아님

## /reports/monthly 동작 확인 완료

- 목표 없는 유저 → 안내 템플릿, `cached: false`, `date_range`는 30일 폭으로 정상 계산
- 같은 날 재조회 → `cached: true`
- 목표 소급 적용 수정: `/reports-weekly`와 동일하게 목표 설정 이전 날짜가 집계에서 제외되고 "N일 중" 표기도 정확하게 줄어드는 것 확인
- 목표+로그(여러 주에 걸쳐 분산) 있는 유저 → 달성/미달/기록없음 카운트 합이 정확히 30일과 일치, 패턴 분석 섹션도 정상 반영 확인

---

## GET /functions/v1/insights

최근 28일 데이터 기반 요일별 평균 루틴 점수 + 최근 트렌드. 패턴 파악용, AI 리포트와 무관하게 즉시 계산되는 순수 통계 엔드포인트(Claude 호출 없음).

**요청 헤더**
```
Authorization: Bearer <access_token>
```

**응답 200**
```json
{
  "date_range": { "from": "2026-07-18", "to": "2026-08-14" },
  "weekday_averages": [
    { "weekday": 5, "label": "금", "avg_daily_score": 100, "days_counted": 1 }
  ],
  "best_weekday": { "weekday": 5, "label": "금", "avg_daily_score": 100 },
  "worst_weekday": { "weekday": 5, "label": "금", "avg_daily_score": 100 },
  "trend": { "direction": "up", "recent_avg": 70, "previous_avg": 55 }
}
```

- `weekday`: 0(일)~6(토), UTC 기준. `weekday_averages`는 요일 오름차순 정렬
- **집계 대상**: `daily_score`(각 날짜 `/scores`와 동일 계산)가 계산되는 날짜만 포함. 목표를 하나도 설정 안 했으면 전부 제외, **그 목표를 실제로 설정하기 이전 날짜도 제외**(2026-08-14 수정 — 최초에는 이 부분이 빠져서 막 가입한 유저의 지난 27일이 전부 0점으로 잡히는 문제가 있었음, 아래 참고)
- 요일별 데이터가 하나도 없으면 `weekday_averages: []`, `best_weekday`/`worst_weekday`: `null`
- `trend`: 최근 7일 평균 vs 그 이전 7일 평균. 두 구간 모두 데이터가 있어야 계산, 하나라도 없으면 `null`. 두 평균 차이가 3점 이하면 `"flat"`(반올림 노이즈로 오인 방지), 그보다 크면 `"up"`/`"down"`

## /insights 동작 확인 완료

- `computeInsights` 유닛 테스트 7개(빈 데이터/null 제외/요일별 평균/최우수·최악 요일/트렌드 null·계산·flat 임계값) + `goalsExistingBy` 유닛 테스트 2개 통과
- 실제 배포본에서 확인: 목표를 오늘 막 설정한 계정으로 과거 로그를 찍어봤더니 목표 설정 이전 날짜는 전부 집계에서 제외되고 오늘 하루만 반영되는 것 확인. 서비스롤로 목표의 `created_at`을 과거로 되돌려서 여러 주에 걸친 요일별 평균/트렌드 계산이 정확한 것도 재확인

## 레이트리밋/환경변수 점검 완료 (Day 13-14 착수분)

- **레이트리밋**: `rate_limits` 테이블 + `check_rate_limit()` Postgres 함수(고정 1분 윈도우)를 4개 함수 전부에 연결. 실제 요청으로 검증: DB 함수 자체(작은 한도로 직접 RPC 호출해 3회 통과 후 4회째 차단 확인), `/reports-weekly` 실제 엔드포인트에서 10회 통과 후 11회째 `429` 확인(두 번 재현), 유저별 독립적으로 적용되는 것도 확인
- **환경변수**: `.env`/`.env.local`이 git에 커밋된 적 없음, git history 전체에 service_role/Anthropic 키 노출 없음(anon key만 있고 이건 iOS 공유용으로 의도된 것), 함수 코드에 하드코딩된 시크릿 없음, Supabase 프로젝트 시크릿은 플랫폼 자동 주입분만 존재 확인. `ANTHROPIC_API_KEY`는 여전히 미설정 상태(템플릿 폴백으로 정상 동작 중이며, 실제 Claude 응답을 보려면 별도로 시크릿 등록 필요)

## 2026-08-14 추가: 삭제 기능

로드맵 원안에는 없었지만 iOS팀 요청으로 추가:
- `DELETE /logs?id=<uuid>` — 잘못 기록한 로그 삭제
- `DELETE /goals?target_type=<string>` — 목표 추적 중단(완전 삭제)

둘 다 RLS delete 정책 추가(`routine_logs_delete_own`, `goals_delete_own`) 후 실제 테스트 계정 2개로 라이브 검증: 정상 삭제(204), 없는 리소스(404), 필수 파라미터 누락(400), 다른 유저 소유 리소스 삭제 시도가 항상 404로 막히는 것(RLS)까지 확인하고 배포 완료.

같은 날, `/reports-weekly`의 요일별 집계에서 DB 타임스탬프(`+00:00`)와 내부에서 만든 날짜 경계 문자열(`.000Z`)을 문자열로 비교하던 버그도 발견해 수정 — 자정 정각 로그가 문자열 형식 차이 때문에 하루 전날로 잘못 집계될 수 있었음. epoch 비교로 수정, 응답 포맷 변화 없음.

## 2026-08-14 추가: 통합 루틴 점수 (`daily_score`)

기획 방향("애플워치 수면점수처럼 하루를 하나의 숫자로") 반영. `GET /scores` 응답에 `daily_score` 필드 추가 — 필드 이름/계산 방식(0~100, missing=0점) 모두 iOS팀과 사전 협의 후 확정. 기존 `date`/`scores` 필드는 그대로라 하위 호환.

**같은 날 추가 보완**: 목표가 1~2개뿐이면 달성 개수 기반 계산이 0/50/100으로만 나오는 문제가 있어, `not_achieved`에도 목표 근접도 기반 부분점수를 주는 방식으로 개선(위 `daily_score` 필드 설명 참고). 유닛 테스트 8개 + 실제 배포본 라이브 검증(목표 없음→null, 전부 missing→0, 일부 달성→50, 전부 달성→100, 부분점수 혼합→58) 완료.

## 구현 완료

로드맵의 4개 엔드포인트(`/logs`, `/goals`, `/scores`, `/reports/weekly`) 모두 구현/배포/테스트 완료. 레이트리밋·환경변수 점검도 완료. iOS팀과의 통합 테스트, 프로덕션 배포, 삭제 기능, `daily_score`, `/reports-daily`, `/insights`, 리포트 패턴 반영(AI 피드백 고도화), `/reports-monthly`까지 전부 끝났고 로드맵상 남은 백엔드 작업은 없음. 기획안이 제시한 5개 우선순위 기능 확장 전부 완료.
