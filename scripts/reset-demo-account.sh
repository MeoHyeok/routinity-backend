#!/usr/bin/env bash
# 시연용 데모 계정(routinity.demo@mailinator.com)의 기록/목표/AI 리포트를 전부
# 지워서 매 시연마다 처음 상태로 되돌리는 스크립트. 계정 자체(로그인)는 그대로
# 유지되고, 그 계정이 쌓은 데이터만 삭제된다 — 시연할 때마다 새 이메일로
# 가입시키지 않아도 되게 하려는 목적 (Supabase 기본 메일 발송이 시간당 2통
# 제한이라 여러 명 앞에서 매번 새로 가입시키면 확인 메일이 막힘).
#
# service_role 키로 RLS를 우회해서 직접 지우므로, .env에 실제
# SUPABASE_SERVICE_ROLE_KEY가 있어야 동작한다.
#
# 사용법: ./scripts/reset-demo-account.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "error: .env not found at ${ENV_FILE} (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 필요)" >&2
  exit 1
fi

export $(grep -E '^SUPABASE_URL=|^SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" | xargs)

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "error: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 .env에 설정되어 있지 않음" >&2
  exit 1
fi

# routinity.demo@mailinator.com — 2026-08-14에 만들어진 고정 데모 계정
DEMO_USER_ID="6266c044-3a53-4aad-864f-6788df127582"

echo "데모 계정(${DEMO_USER_ID}) 데이터 초기화 중..."

for table in routine_logs goals ai_reports; do
  status=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${DEMO_USER_ID}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Prefer: return=minimal")
  if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    echo "  ${table}: 삭제 완료"
  else
    echo "  ${table}: 실패 (HTTP ${status})" >&2
    exit 1
  fi
done

echo "완료 — routinity.demo@mailinator.com 로 로그인하면 빈 상태로 시작합니다."
