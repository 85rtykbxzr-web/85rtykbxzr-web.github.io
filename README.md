# 서울독립영화관시간표

서울의 독립·예술영화관 상영시간표와 좌석 상태를 보여 주는 정적 웹사이트입니다.

- 운영 사이트: https://seoulcinemaschedule.com
- GitHub Pages 검증 사이트: https://85rtykbxzr-web.github.io

## 전환 상태 — 2026-09-09

GitHub Actions 계정 실행 제한은 해제되어 클라우드 작업을 실행할 수 있습니다. 최신 앱·검증 코드, 주말/공휴일 상영 누락 수정, sharp 보안 업데이트를 반영했습니다.

전체 자동 수집은 아직 전환 조건을 충족하지 못했습니다. GitHub 표준 Linux·macOS·Windows 러너에서 Dtryx의 공식 API와 공개 예매 API 연결 시간이 초과됩니다. 실제 전체 수집에서는 8개 출처의 최신 검증을 완료하지 못해 새 데이터 커밋과 배포를 중단했습니다. 마지막 정상 데이터를 최신이라고 표시하도록 안전장치를 완화하지 않습니다.

- 전체 수집 검증: https://github.com/85rtykbxzr-web/85rtykbxzr-web.github.io/actions/runs/34299146110
- 운영체제별 실제 API 연결 검사: https://github.com/85rtykbxzr-web/85rtykbxzr-web.github.io/actions/runs/34299880814

검증 사이트의 초기 데이터는 2026-09-09에 정상 수집·감사한 스냅샷입니다. 운영 도메인 전환 전까지 검증 사이트는 검색 색인을 차단합니다.

## 자동화와 안전장치

전체 수집·좌석 갱신·배포에는 GitHub 호스팅 러너와 저장소별 `GITHUB_TOKEN`만 사용합니다. 외부 쓰기 토큰이나 개인 PC 접속은 사용하지 않습니다.

예약 정의는 준비되어 있지만, `HOSTED_COLLECTION_READY=true`인 경우에만 실행됩니다. 현재 이 조건은 충족되지 않았습니다. 연결 문제 해결 후 `full`, `seats`, `deploy`, `site-health` 실행과 예약 실행의 최신성 검사를 모두 통과한 뒤 활성화합니다.

- 전체 시간표·추천: KST 3시간마다 `:07`
- 좌석: KST 08–23시 15분 간격(전체 수집과 중복하지 않음)
- 사이트 점검: 매일 KST 09:43

전체/좌석 작업은 직렬화됩니다. 오래 대기했거나 출처·회차·날짜 검증에 실패한 작업은 배포하지 않습니다. HTML 스냅샷은 민감한 토큰 모양 값을 제거하고 공개 감사를 거칩니다. 전체 수집 데이터만 커밋하고, 좌석은 배포 산출물만 갱신합니다.

`PRODUCTION_READY=true`는 실제 운영 전환과 검증을 완료했을 때만 설정하여 검색 색인을 허용합니다. GitHub 페이지의 배포 성공만으로 운영 전환이 완료된 것은 아닙니다.

## 검증 및 수동 실행

Node.js 22.23.2를 사용합니다.

```sh
npm ci
npm run check
npm run audit:deps
npm run audit:public
npm run build:static
```

GitHub Actions의 `Refresh and deploy GitHub Pages`에서 `full`(전체 수집), `seats`(좌석 갱신), `deploy`(검증된 커밋 데이터 배포)를 실행합니다. `CI`와 `Check public site health`도 수동 실행할 수 있습니다.

배포 후 홈페이지·healthz.json·일정·추천을 다시 읽어 배포 ID와 생성 시각을 검증합니다. 데이터에 표시된 생성 시각을 기준으로 최신성을 판단합니다.
