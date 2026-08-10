# 루티니티 백엔드 로드맵 (2주 스프린트)

담당: 백엔드 단독 | 파트너: iOS 프론트 (병렬 진행)
스택 가정: Supabase (Postgres + Auth + Edge Functions) — 변경 시 이 문서 스택 부분만 교체

---

## 0. 우선순위 원칙

1. **Day 3-4 API 계약이 가장 중요**. 늦어지면 iOS 팀원이 통째로 대기함.
2. AI 피드백(Day 8-10)이 가장 밀릴 위험 구간. 늦어지면 룰 기반 템플릿으로 먼저 출시.
3. 알림은 서버가 아니라 최대한 클라이언트(iOS)가 로컬로 판단하게 위임 — 서버 부담 최소화.

---

## 1. 데이터베이스 스키마

```sql
-- 사용자 (Supabase Auth가 기본 관리)
users (
  id uuid primary key,
  email text,
  created_at timestamptz default now()
)

-- 루틴 이벤트 로그
routine_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  type text, -- wake | meal | study_start | study_end
  timestamp timestamptz not null,
  created_at timestamptz default now()
)

-- 사용자별 목표 (대조군)
goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  target_type text, -- wake_time | study_duration 등
  target_value text,
  updated_at timestamptz default now()
)

-- AI 리포트
ai_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  period text, -- daily | weekly
  content text,
  created_at timestamptz default now()
)
```

---

## 2. API 엔드포인트 명세 (초안 — iOS팀 공유용)

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/logs` | 이벤트 기록 (기상/식사/공부 시작·종료) |
| GET | `/logs?date=YYYY-MM-DD` | 특정 날짜 로그 조회 |
| POST | `/goals` | 목표(대조군) 설정 |
| GET | `/goals` | 목표 조회 |
| GET | `/scores?date=YYYY-MM-DD` | 그날 점수 조회 |
| GET | `/reports/weekly` | 주간 AI 리포트 조회 |

**요청/응답 예시**

```
POST /logs
요청: { "type": "study_start", "timestamp": "2026-08-10T09:00:00Z" }
응답 201: { "id": "log_abc123", "type": "study_start", "timestamp": "...", "created_at": "..." }
```

> 필드명/타입이 바뀌면 Day 4 이후엔 반드시 팀 채널에 즉시 공지.

---

## 3. 2주 타임라인

| Day | 작업 | 완료 기준 |
|---|---|---|
| 1-2 | Supabase 프로젝트 생성, 스키마 설계, Auth 연결 | 테이블 4개 생성 완료, 테스트 유저로 로그인 확인 |
| 3-4 | 로그 기록 API (`/logs` CRUD) + iOS팀과 API 계약 확정 | iOS팀이 계약서 받고 프론트 개발 착수 |
| 5 | 목표 설정 API (`/goals`) | 목표값 저장/조회 정상 동작 |
| 6-7 | 스코어링 로직 구현 | 달성/미달/누락 3케이스 테스트 통과 |
| 8-10 | AI 피드백 엔드포인트 (`/reports/weekly`) | 실제 로그로 리포트 텍스트 생성 확인 |
| 11-12 | iOS팀과 통합 테스트 | 앱에서 기록→점수→리포트까지 엔드투엔드 확인 |
| 13-14 | RLS·레이트리밋·환경변수 점검, 배포 | 프로덕션 배포 + 기본 로깅 연결 |

---

## 4. 체크리스트

- [ ] Supabase 프로젝트 생성
- [ ] 스키마 4개 테이블 생성 (users, routine_logs, goals, ai_reports)
- [ ] Auth 연결 테스트
- [ ] `/logs` POST/GET 구현
- [ ] API 계약 문서 iOS팀 전달
- [ ] `/goals` POST/GET 구현
- [ ] 스코어링 함수 구현 + 테스트 케이스 3종
- [ ] Claude API 연동 (`/reports/weekly`)
- [ ] AI 리포트 fallback(룰 기반 템플릿) 준비
- [ ] iOS팀과 통합 테스트
- [ ] RLS 정책 적용
- [ ] API 레이트리밋 설정
- [ ] 환경변수 분리 (.env, 시크릿 관리)
- [ ] 프로덕션 배포
- [ ] 기본 로깅/모니터링 연결

---

## 5. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| AI 리포트 생성 지연 | 룰 기반 템플릿 문장으로 먼저 출시, 이후 LLM으로 교체 |
| iOS팀과 계약 어긋남 | Day 3-4에 필드명/타입까지 확정, 이후 변경 시 즉시 공지 |
| 시간 부족 | 4단계(데이터 자산화)는 이번 스프린트 범위 아님 — 완전히 제외 |

---

## 6. 개발 환경

- IDE: VS Code + Claude Code 확장
- 백엔드: Supabase (Postgres + Auth + Edge Functions, TypeScript)
- AI 연동: Anthropic Claude API
- 문서 공유: 이 파일을 프로젝트 루트에 `ROADMAP.md`로 두고 Claude Code에게 컨텍스트로 전달
