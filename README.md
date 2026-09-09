# 서울독립영화관시간표

서울의 독립·예술영화관 상영시간표와 좌석 상태를 보여 주는 정적 웹사이트입니다.

- 운영 주소: https://seoulcinemaschedule.com
- GitHub Pages: https://85rtykbxzr-web.github.io

## 맥북 없이 작동하는 방식

GitHub Pages가 사이트를 제공하고 GitHub Actions가 공개 데이터를 자동 갱신합니다. 개인 PC, 별도 수집 서버, VPN, 외부 쓰기 토큰은 필요하지 않습니다.

- **GitHub에서 수집하는 8개관:** 시네마테크KOFA, 서울아트시네마, 인디스페이스, 씨네큐브, 필름포럼, KU시네마테크, KT&G 상상마당, 무비랜드.
- **방문 시 공식 API를 직접 조회하는 7개관:** 모모, 에무, 아리랑, 아트나인, 라이카, 더숲, 헤이리. 시간표와 좌석은 브라우저에서 함께 갱신됩니다. 방문 시 조회하고, 열린 탭은 10분 간격 및 다시 활성화될 때 갱신합니다.

Dtryx는 GitHub의 Linux·macOS·Windows·ARM 러너에서 TCP 연결 시간이 초과됩니다. 일반 HTTPS 포트도 동일했습니다. 반면 브라우저의 공개 CORS API 조회는 정상입니다. 이 때문에 7개관의 정지된 데이터를 서버의 최신 수집 결과로 보관하는 대신 브라우저에서 검증합니다.

서울아트시네마와 모모의 게시판은 클라우드 방문자에게 시간표 대신 CUPID 브라우저 확인 페이지를 반환합니다. 수집기는 그 공식 페이지의 정해진 AES 필드만 해석하여 익명 확인 쿠키를 요청 중에 사용합니다. 외부 JavaScript 실행이나 사용자 로그인 쿠키 복사는 하지 않습니다.

## 데이터와 검증

`SCHEDULE_COLLECTION_MODE=browser-live`는 GitHub 수집 모드입니다. 공개 JSON에는 서버가 검증한 8개관의 회차만 들어갑니다. 7개관은 `meta.browserLiveVenueIds`와 출처별 `deferredToBrowser`로 명시되며, 서버 검증 성공이나 회차 수를 주장하지 않습니다. 앱은 공식 조회가 성공한 영화관부터 화면에 추가합니다.

서버 감사는 8개관의 기존 회차·날짜·최신성 기준을 유지하고, 7개관의 명시적 위임 계약과 저장 회차 부재를 검사합니다. 브라우저 역시 공식 응답 성공, 필수 필드, 날짜, 중복 ID, 회차·날짜 수를 검증합니다. 실패하면 해당 영화관의 오래된 회차를 최신으로 표시하지 않고 공식 링크와 다시 확인 버튼을 제공합니다. 화면은 서버 수집 시각과 실시간 확인 시각을 구분합니다.

휴일 표시 `RestYn=Y`도 공개 상영 날짜입니다. `HiddenYn=Y`만 제외하여 주말·공휴일 상영을 누락하지 않습니다.

## 예약과 배포

`HOSTED_COLLECTION_READY=true`일 때 예약 수집과 사이트 점검을 실행합니다. `PRODUCTION_READY=true`일 때 검색 색인을 허용합니다. 최초 활성화 전에 전체 수집·좌석 갱신·배포·사이트 점검과 실제 브라우저 조회를 확인합니다.

2026-09-09 운영 도메인을 GitHub Pages로 전환하고 두 변수를 활성화했습니다. 운영 전환 검증은 [전체 수집·배포](https://github.com/85rtykbxzr-web/85rtykbxzr-web.github.io/actions/runs/34304129567), [좌석 갱신·배포](https://github.com/85rtykbxzr-web/85rtykbxzr-web.github.io/actions/runs/34304313311), [공개 사이트 점검](https://github.com/85rtykbxzr-web/85rtykbxzr-web.github.io/actions/runs/34304394694)에서 모두 통과했습니다. 실제 운영 브라우저에서 7개관 조회도 확인했습니다.

본 주소의 A 레코드는 GitHub Pages 공식 IP 4개에 직접 연결하며, GitHub가 인증서를 관리하고 HTTPS를 강제합니다. Cloudflare는 DNS 관리와 `www` → 본 주소 리디렉션에 사용합니다. GitLab·Render·개인 맥북은 운영 사이트의 수집·배포에 필요하지 않습니다.

- 전체 시간표·추천: KST 3시간마다 `:07`
- 좌석: KST 08–23시 15분 간격(전체 수집과 중복하지 않음)
- 공개 사이트 점검: 매일 KST 09:43

예약 시각은 목표 시각이며 GitHub Actions 대기열에 따라 실제 시작이 늦어질 수 있습니다. 마지막 갱신 시각은 사이트와 `healthz.json`에 표시됩니다.

전체/좌석 작업은 직렬 실행합니다. 대기 중 배포 설정이 바뀌거나, main이 이동하거나, 데이터 검증에 실패하면 배포하지 않습니다. 전체 수집 데이터만 커밋하고 좌석 갱신은 배포 산출물에 반영합니다. 정리한 HTML 스냅샷과 코드에는 공개 감사를 적용합니다.

GitHub Actions의 `Refresh and deploy GitHub Pages`에서 `full`, `seats`, `deploy`를 수동 실행할 수 있습니다. `CI`와 `Check public site health`도 수동 실행을 지원합니다.

## 로컬 검증

Node.js 22.23.2를 사용합니다.

```sh
npm ci
npm run check
npm run audit:deps
npm run audit:public
SCHEDULE_COLLECTION_MODE=browser-live npm run update:sources
npm run build:static
```

`test:browser-live`는 휴일 상영, 중복 회차 거부, 부분 연결 실패, 검증 시각 보존, 서버/브라우저 수집 계약, CUPID 처리 범위를 검사합니다. 배포 후 홈페이지·healthz·일정·추천의 배포 ID와 생성 시각을 다시 검증합니다.
