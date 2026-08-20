# 협업자 셋업 가이드

이 프로젝트는 저장소 3개로 나뉘어 있습니다 — 백엔드(`routinity-backend`, 이 저장소), iOS 앱(`routinity-ios`), 웹 클라이언트(`routinity-web`). 아래 순서대로 진행하면 됩니다. 막히는 단계가 있으면 에러 메시지를 그대로 복사해서 ChatGPT나 Claude 같은 AI한테 물어봐도 충분히 도움받을 수 있는 수준의 작업입니다.

`routinity-backend`는 이제 public repo라 클론만 하면 되고, `.env`용 `SUPABASE_URL`/`SUPABASE_ANON_KEY`도 `docs/api-contract.md`에 이미 공개돼 있어서 그대로 복사해도 됩니다(민감정보 아님). `SUPABASE_SERVICE_ROLE_KEY`나 iOS 실기기 서명처럼 진짜 프로젝트 멤버십이 필요한 부분만 아래 0번 초대가 필요합니다.

`routinity-web`은 셋업이 훨씬 간단합니다(환경변수도 없음) — 별도 가이드는 그 저장소의 `SETUP.md` 참고.

## 0. 초대 수락

- GitHub 저장소 초대(`routinity-backend`, `routinity-ios`) 수락 — `routinity-web`은 public이라 초대 불필요
- Supabase 프로젝트 초대 수락 (이메일로 옴, 없으면 프로젝트 소유자에게 요청) — `SUPABASE_SERVICE_ROLE_KEY`나 실기기 서명이 필요 없다면 이 초대 없이도 anon key만으로 두 앱 다 돌려볼 수 있음

## 1. 백엔드 (routinity-backend)

```
git clone https://github.com/MeoHyeok/routinity-backend.git
cd routinity-backend
```

1. Node.js 설치 (없으면): `brew install node`
2. 의존성 설치: `npm install`
3. Supabase CLI 로그인 + 프로젝트 연결:
   ```
   npx supabase login
   npx supabase link --project-ref noqvrfewkyfdrsoaszmz
   ```
4. `.env` 파일 만들기:
   ```
   cp .env.example .env
   ```
   Supabase 대시보드 > Project Settings > API에서 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`를 확인해서 채워 넣기. `ANTHROPIC_API_KEY`는 없어도 동작함(템플릿 폴백).
5. 테스트 실행 (정상 셋업 확인용): `npm test` — 전부 통과해야 정상

Edge Function을 로컬에서 직접 띄우고 싶으면(선택, Docker Desktop 필요):
```
npx supabase start
npx supabase functions serve
```
이 단계 없이도 이미 배포된 프로덕션 API를 그대로 호출하며 코드만 로컬에서 보는 것도 가능합니다.

## 2. iOS 앱 (routinity-ios)

routinity-ios 저장소를 GitHub 초대 링크로 클론합니다.

1. **Xcode 26.6 이상** 설치 (App Store 또는 developer.apple.com) — 이 프로젝트가 iOS 26.5 SDK를 타겟으로 해서, 구버전 Xcode엔 그 SDK가 없어서 안 됩니다.
2. **의존성**: 따로 할 거 없음 — Swift Package Manager만 사용해서, `.xcodeproj`를 Xcode로 열면 자동으로 다운로드됩니다. 멈춘 것처럼 보이면:
   ```
   xcodebuild -resolvePackageDependencies -project RoutinityApp.xcodeproj -scheme RoutinityApp
   ```
3. **Supabase 연결 설정 (가장 놓치기 쉬운 단계)**: 저장소 루트의 `Secrets.example.plist`를 복사해서 `RoutinityApp/Resources/Secrets.plist`로 만들고, `SUPABASE_URL`/`SUPABASE_ANON_KEY`를 (1번에서 확인한 것과 동일한) Supabase 대시보드 값으로 채워 넣습니다. 이 파일은 시크릿이라 `.gitignore`돼 있어서 클론해도 안 생깁니다 — 안 만들면 앱은 빌드/실행은 되는데 백엔드 연결이 안 되고 콘솔에 경고만 뜹니다.
4. **시뮬레이터로 실행**: `Secrets.plist`만 채웠으면 프로젝트 열고 시뮬레이터 아무거나 선택 후 `Cmd+R`. 서명 문제 없이 바로 됩니다.
5. **실기기로 실행할 때만 (선택)**: 프로젝트에 박혀있는 `DEVELOPMENT_TEAM`이 소유자 개인 Apple ID 팀이라, 협업자 본인 기기에서 돌리려면:
   - Xcode > Settings > Accounts에 본인 Apple ID 추가 (무료 Personal Team이면 충분, 유료 Developer Program 필요 없음)
   - 타겟의 Signing & Capabilities 탭에서 Team을 본인 걸로 변경
   - 기기에서 설정 > 개인정보 보호 및 보안 > 개발자 모드 켜기
   - 첫 설치 후 설정 > 일반 > VPN 및 기기 관리에서 개발자 인증서 신뢰
   - 이건 로컬 전용 변경이라(`xcuserdata`가 gitignore됨) 다른 사람 셋업엔 영향 없음

## 3. 웹 클라이언트 (routinity-web)

```
git clone https://github.com/MeoHyeok/routinity-web.git
cd routinity-web
npm install
npm run dev
```

- Node.js `^20.19.0` 또는 `>=22.12.0` 필요 (Vite 8 요구사항)
- `http://localhost:5173/routinity-web/`로 접속 — 끝의 `/routinity-web/`까지 들어가야 함(`vite.config.ts`의 base 경로), `/`로만 들어가면 빈 화면일 수 있음
- **환경변수 설정 필요 없음** — Supabase URL/anon key가 `src/lib/supabase.ts`에 이미 들어있음(anon key는 공개돼도 되는 키, RLS로 보호되는 구조는 iOS/백엔드와 동일)
- 로그인은 새로 회원가입하거나 공유 테스트 계정 사용. `npm run build`(타입체크+빌드), `npm run lint`로 PR 전 확인 가능
- 자세한 내용은 그 저장소의 `SETUP.md` 참고

## 문제가 생기면

각 단계에서 나오는 에러 메시지를 그대로 복사해서 AI(ChatGPT/Claude 등)한테 "이 가이드의 O번 단계를 따라하다가 이런 에러가 났어"라고 물어보면 됩니다.
