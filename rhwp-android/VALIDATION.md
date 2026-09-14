# rHWP Fold 검증 기록

2026-09-13 작업 중 기록. 통과 표시의 범위를 넘어 실기기·모든 문서의 동작을 보장하지 않는다.

| 검사 | 결과 | 근거/범위 |
|---|---|---|
| 상용구 0.1.1 | 시험 구현 | 글자/본문 등록, 기기 내 저장, Alt+i 실행, Ctrl+F3 목록, 터치 메뉴 |
| 상용구 다른 문서 왕복 | 통과 | 글자, 굵게 서식, 2칸 표, 단독 PNG 그림. 전체 한글 개체 보존을 뜻하지 않음 |
| 상용구 실행 취소 | 통과 | 준말 치환 후 undo는 준말 복원, redo는 본말 복원 |
| 상용구 저장 유지 | 통과 | 디버그 APK 업데이트/프로세스 재시작 후 저장한 글자 상용구 실행 |
| 원본 고정 | 확인 | cac9b4f7에서 Rust와 Studio 빌드 |
| WASM release | 통과 | Rust 1.93.1, wasm-pack 0.15.0, wasm-opt 완료 |
| Studio 타입/배포 빌드 | 통과 | Android 환경 플래그, PWA 제외, 로컬 글꼴 포함 |
| Studio 자동 테스트 | 통과 | Node 24: 1,367 pass, 1 skip, 0 fail |
| Android 저장 단위 테스트 | 통과 | 6개: 바이너리 왕복, 누락/순서 오류, 읽기전용, 외부 변경, 동일 파일 식별 |
| Android lint/debug/release 빌드 | 통과 | JDK 17, API 36 |
| 개인 서명 | 통과 | APK Signature Scheme v2 검증 |
| 에뮬레이터 실행 | 통과 | API 36 arm64 Pixel Fold 프로필 |
| HWP 저장·재열기 | 통과 | 실제 SAF 선택창, 한글 문장, 13,312바이트 |
| HWPX 저장·재열기 | 통과 | 실제 SAF 선택창, 한글 문장, 7,478바이트 |
| 저장 취소 | 통과 | 수정 상태·내용 유지 |
| 접기·펼치기 10회 | 통과 | 20회 화면 변경, 412dp↔842dp, 내용·커서·확대·dirty·undo 유지 |
| 전환 후 undo/redo | 통과 | 추가한 문장 제거/복원 일치 |
| 상태 표시줄 | 통과 | Android 버튼 바와 겹치지 않는 DOM 좌표 확인 |
| Android PDF 저장 | 수정 후 통과 | 로컬 HTTPS HTML 제공·표준 용지 ID로 수정. 실제 PDF 51,639바이트, A4 595×841pt 1쪽, 한글 본문 추출·렌더 확인 |
| 자동복구 | 내용 복원 통과 | HWPX 수정 후 체크포인트, 프로세스 재실행·복구 선택으로 수정 문장 복원. 원본 복구 방식은 HWP 변환본 |
| 회전·분할 화면 | 대기 | 실제 상태 보존 추가 검사 필요 |
| 비행기 모드 첫 실행 | 대기 | INTERNET 권한 없음은 확인, 새 설치 오프라인 실행 별도 검사 |
| 삼성 키보드/실제 Fold7 | 기본 흐름 사용자 확인 | 개인 서명 APK 설치 후 한글 입력·접기/펼치기 정상 응답. 10회 반복/한글 조합 중 전환은 별도 검사 |
| Android 상단 메뉴 터치 | 에뮬레이터 수정 확인·실기기 응답 대기 | 수정 전 입력 포커스 검사 실패. 수정 후 접힌/펼친 화면에서 파일→편집→보기→입력 연속 터치·메뉴 항목 노출·입력 포커스 해제 통과. 폰에 메뉴 수정 APK 업데이트 완료 |
| 크기별 성능 | 대기 | 소형 테스트 문서 외 대형 문서 미측정 |
| GitHub CI/PR | 초기 구현 통과 | PR #2, Actions run 34706461419 성공. 이후 수정 커밋은 별도 검사 |

테스트용 문서는 공개 빈 문서에 시험 문장을 입력해 만들었다. 개인 문서는 사용하지 않았다.
기기 주소, pairing code, 서명키와 원시 기기 로그는 공개 기록에 넣지 않는다.
에뮬레이터와 실제 삼성 Fold7의 해상도·키보드·시스템 동작은 다르므로 서로 대신하는 검증으로 취급하지 않는다.

## 재현 도구

`scripts/emulator-inspect.mjs`는 디버그 WebView에 ADB 포워딩한 로컬 CDP에서 문서 상태를 읽는다.
`scripts/fold-cycle-qa.mjs`는 전용 에뮬레이터에서 반복 전환과 undo/redo를 검사한다.
`scripts/menu-touch-qa.mjs`는 입력 포커스를 준 뒤 메뉴를 실제 터치 이벤트로 연속 전환한다.
JavaScript로 넣은 한글 문자열은 삼성 IME 조합 검사의 대체물이 아니다.

## 0.1.2 파일 연결 등록 (2026-09-13)

- HWP/HWPX MIME 별칭을 VIEW/SEND에 일치시켰다. 일반 MIME/형식 누락은 URI 확장자로 제한한 VIEW 필터로 보완했다.
- Android 11·14 Robolectric: 연결 후보 6개 테스트 + 기존 파일 저장 6개 테스트, 총 12개 통과.
- API 36 에뮬레이터 실제 PackageManager 연결 후보 10사례 통과: 한글 문서/대문자/점 7개 HWPX/형식 없는 file URI 포함. 일반 PDF·ZIP·형식 없는 숫자 URI는 제외.
- Android Files에서 기존 합성 시험 문서 `fold-qa.hwpx`를 눌러 앱 실행 → 복구 안내 ‘나중에’ → 엔진 본문과 파일 이름, sourceFormat=hwpx, isDirty=false 확인.
- 터미널에서 권한 없는 content URI를 직접 전달하는 검사는 Android SecurityException으로 거절됨. 실제 Files 경유 권한 전달로 다시 검사하여 성공.
- lintDebug/testDebugUnitTest/assembleDebug/assembleRelease 통과, 개인 서명 검증 통과.
- APK: outputs/rHWP-Fold-0.1.2.apk (Git 제외).
- SHA-256: `8d03842f686af1c884aa57ef7d2dfc4b3baab8f6a9983aee3643b1f073205ad8`.
- 폴드7 무선 디버깅 연결이 없어 0.1.2 실기기 설치 및 삼성 내 파일에서 ‘항상’ 선택은 미검증.

## 0.1.3 아이콘 (2026-09-13)

- 남색 배경, 흰 문서, 파란 접힘, ㅎ 시안을 Android 벡터로 구현했다.
- 적응형 배경/전경과 API 33 이상 단색 테마용 리소스를 제공한다.
- assembleDebug/assembleRelease/lintDebug 성공. 폴드7 업데이트 설치 Success 및 versionName=0.1.3 확인.
- 에뮬레이터는 연결되어 있지 않았다. 폴드7 화면 캡처는 알림 설정 화면이어서 아이콘 시각 검증 증거로 사용하지 않았다. 홈 화면에서 사용자의 최종 확인이 필요하다.
- APK: outputs/rHWP-Fold-0.1.3.apk (Git 제외).

## 0.1.4 편집·복구 회귀 검사 (2026-09-14)

- 사용자 보고: 편집 중 복구 안내, 자간 단축키의 의도치 않은 쪽 나눔, 스타일 단축키 누락, 한글 조합 중 상용구와 추가 줄바꿈.
- 수정 전 APK: `number-bullet.hwp`의 세 번째 문단을 선택하고 Alt+Shift+N을 누르면 1→2쪽. 실제 키 이벤트를 쓰는 `scripts/editing-regression-qa.mjs`에서 실패 확인.
- 엔진 회귀 테스트 `android_formatting_page_flow`: 2개 통과. 공개 예제 3개 × 자간 ±1/장평 ±1 변경, HWP 저장·재열기·서식 복원, 스타일·줄 간격 변경 검사.
- Rust 필수 검사: 포맷, native Clippy, WASM32 Clippy, workspace build, workspace all-target Clippy, 파생 suite 검사 모두 통과. 검토 작업트리의 소스와 검사 파일 해시 일치.
- Studio/편집기 Node 24 테스트: 1,374 pass, 1 skip, 0 fail.
- 최종 APK의 WebView 실제 조합 이벤트: Alt+I로 준말 치환, 추가 문단/개행 없음, undo/redo, 조합 중 Ctrl+2와 undo 순서 통과. 뒤늦은 compositionend/input에도 글자 중복 없음.
- 최종 APK: 강제 종료 후 복구 창 1회 및 내용 복원, 16.5초 연속 입력 중 주기적 자동 저장, 종료 취소 시 수정 상태 유지, 저장 안 함으로 정상 종료 후 복구 창 없음, 깨끗한 문서 체크포인트 후 재시작에서 복구 창 없음 모두 통과.
- 개인 문서는 사용하지 않았다. 공개 예제와 합성 문장만 사용하며 기기 주소는 기록하지 않는다.

- 원본 전체 release-test: **8,927 pass / 46 skip / 0 fail** (nextest 실행 158.732초, 최초 컴파일 시간 별도).
- Native Skia 3종: lib **4,128 pass / 13 ignored**, 이미지 placeholder 2개, direct PDF 4개 통과.
- APK 작성 흐름: 기존 HWP 3종에서 Alt+Shift+N/W/J/K/E/R 및 undo 후 1/1/6쪽 유지. 새 문서 Ctrl+1..0도 문서의 스타일 ID 0..9와 일치.
- 최종 APK 접기·펼치기 10회 및 이후 undo/redo: 내용·커서·확대·dirty·undo 유지 확인.
- 추가 파생 결함: 조합 중 F7 쪽 설정이 열리지 않음을 수정 전 APK에서 확인. F6/F7도 조합 확정 후 실행하도록 보완하고 최종 APK에서 글자 보존·대화상자 열기/닫기 통과.
- 기존 상용구 회귀: 글자·굵게 서식·표·그림의 다른 문서 삽입, undo/redo, Ctrl+F3 목록 모두 통과.
- 실제 Android 저장창: 조합 중 Ctrl+S → 취소해도 글자·dirty 유지. HWP/HWPX 실제 저장 후 dirty=false, 저장 파일을 다시 읽어 1쪽 유지 및 마지막 조합 글자 보존 확인.
- 시각 증거: 공개 `number-bullet.hwp`의 동일 문단 자간 변경을 Android 네이티브 화면으로 대조했다. 수정 전 1→2쪽, 수정 후 1쪽 유지 및 본문 위치 보존. 캡처는 공개 업로드하지 않고 로컬 `evidence/local/0.1.4/spacing-before.png`, `spacing-after.png`에 보관한다.
- 빌드: 같은 소스 WASM, Studio 타입/번들, Android lint/unit/debug/release 및 개인 APK 서명 검증 통과.
- APK: `outputs/rHWP-Fold-0.1.4.apk`, 63,081,795 bytes, SHA-256 `81ffed9a6827f2052c102e2f0100045e598dad3221d227d5d917386722e960ed`.
- 새 회귀 검사: `scripts/editing-regression-qa.mjs` 다음 `scripts/recovery-regression-qa.mjs`를 전용 emulator-5554에 실행한다. 후자는 준비된 합성 문서만 강제 종료한다. `ADB`에 platform-tools/adb 경로를 지정할 수 있다.
- 삼성 키보드·실물 폴드7의 0.1.4 검사는 연결 후 진행한다. WebView 조합 이벤트 검사는 삼성 IME 실기기 통과를 뜻하지 않는다.
