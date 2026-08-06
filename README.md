# 서울독립영화관시간표

서울의 독립·예술영화관 상영시간표와 좌석 상태를 한 화면에서 보여 주는 정적 웹사이트입니다.

- 정식 주소: <https://seoulcinemaschedule.com>
- GitHub Pages 주소: <https://85rtykbxzr-web.github.io>
- 운영 비용: GitHub의 공개 저장소용 표준 Actions와 Pages 범위에서 $0

## 자동 갱신

GitHub 호스팅 러너가 외부 영화관의 공개 정보를 수집하고 검증한 뒤, 정상 산출물만 GitHub Pages에 배포합니다. 개인 컴퓨터나 별도 VPN은 필요하지 않습니다.

- 전체 시간표·추천작: KST 3시간마다 `:07`
- 좌석 상태: KST 08:00–23:59에 `:07`, `:22`, `:37`, `:52`
- 공개 사이트 상태 점검: 매일 KST 09:43

전체 갱신과 좌석 갱신은 한 번에 하나씩 실행됩니다. 수집·검증·빌드가 실패하면 새 배포를 중단하고 마지막 정상 Pages 배포를 계속 제공합니다. 전체 갱신 결과만 `[skip ci]` 데이터 커밋으로 남기며, 좌석 갱신은 저장소 이력을 늘리지 않고 배포 산출물만 교체합니다.

워크플로는 외부 서비스의 쓰기 토큰을 사용하지 않고 저장소별 `GITHUB_TOKEN`만 사용합니다. 사용 중인 GitHub 공식 Action도 전체 커밋 SHA로 고정했습니다. 수집한 HTML snapshot은 커밋 전에 토큰·CSRF·JWT 형태의 값을 제거하고 공개 저장소 감사를 통과해야 합니다.

## 로컬 검증

Node.js `22.23.2`에서 실행합니다.

```bash
npm ci
npm run check
npm run audit:deps
npm run audit:public
STATIC_SITE_INDEXABLE=true npm run build:static
```

정적 산출물은 `dist/`에 생성됩니다. 공개 산출물에는 사이트 화면, 필요한 자산, 검증된 시간표·추천·소스 상태 JSON만 포함됩니다.

## 수동 운영

GitHub의 **Actions → Refresh and deploy GitHub Pages → Run workflow**에서 다음 모드를 실행할 수 있습니다.

- `full`: 전체 시간표와 추천작을 다시 수집하고 배포
- `seats`: 현재 회차의 좌석 상태를 다시 수집하고 배포
- `deploy`: 커밋된 정상 데이터를 다시 빌드해 배포

모든 배포는 `/`, `/healthz.json`, `/data/schedule.json`, `/data/community-trends.json`을 실제 Pages 주소에서 다시 읽어 반영 여부를 확인합니다.
