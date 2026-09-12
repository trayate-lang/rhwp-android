# rHWP Fold

Galaxy Z Fold7의 접힌/펼친 화면에서 쓰는 오프라인 HWP/HWPX 편집기.
원본: https://github.com/edwardkim/rhwp — MIT 라이선스와 원본 고지를 유지한다.

## 기준과 현재 상태

- 원본 기준: `cac9b4f7cc743535cd7c00fe4f286abd67e7145b` (v0.8.6 계열 main).
- 구조: rHWP Studio + Rust/WASM → Android WebView + Kotlin 파일 연결부.
- 통합 브랜치: `android-main`, 원격: `origin`은 내 Fork, `upstream`은 원본.
- 구현/검증 결과는 이 문서와 `VALIDATION.md`를 갱신한다. 실기기에서 검사하지 않은 항목을 성공으로 표시하지 않는다.

## 배울 순서

환경 재현 → 기존 코드 연결 → 파일 저장의 완료/실패 → 화면과 문서 상태 분리 → 테스트 → GitHub 자동 빌드 → 폰 설치.
작업 이유와 다른 프로젝트에 적용할 수 있는 원리는 `LEARNING.md`에 기록한다.

## 빌드

필요 도구: Node 24, Docker, JDK 17, Android SDK API 36/build-tools 36.0.0.
원본 테스트는 Node 26에서 제거된 `--experimental-transform-types` 옵션을 쓰므로 Node 24로 실행한다.
Android 쪽 버전은 AGP 8.13.2, Gradle 8.13, Kotlin 2.2.21, 최소 Android 11(API 30)이다.

```bash
npm ci --prefix rhwp-studio
rhwp-android/scripts/build-wasm.sh
rhwp-android/scripts/build-web.sh
npm test --prefix rhwp-studio
cd rhwp-android
# local.properties에 자신의 Android SDK 경로를 sdk.dir=... 형식으로 설정한다.
./gradlew testDebugUnitTest lintDebug assembleDebug
```

Docker 빌드는 필요한 공개 소스만 복사한다. 개인 키·`.git`·휴대폰 주소·개인 문서는 보내지 않는다.
Rust와 웹 화면은 같은 checkout에서 빌드한다. `pkg/`, `rhwp-studio/dist/`, APK는 생성물이며 Git에 넣지 않는다.
Gradle은 이미 빌드된 `dist`를 포함하므로 웹 코드를 바꿨으면 반드시 `build-web.sh`부터 다시 실행한다.

## HWP·HWPX 기본 연결 앱 (0.1.2)

업데이트 APK 설치 후 삼성 ‘내 파일’에서 HWP 또는 HWPX 파일을 눌러 **rHWP Fold → 항상**을 선택한다.
파일 종류나 전달 앱에 따라 HWP와 HWPX에서 각각 선택이 필요할 수 있다. 선택창에 ‘항상’이 없는 앱도 있다.
이미 다른 앱으로 바로 열린다면 설정 → 애플리케이션 → 기존 앱 → 기본으로 설정 → 기본 설정 삭제 후 다시 연다.
One UI 버전에 따라 항목 이름은 다를 수 있다. 앱이 사용자의 기본 앱 선택을 강제로 바꾸지는 않는다.

MIME(파일 종류 표식)가 한글 문서이면 숫자 주소의 문서도 받는다.
일반 ZIP/바이너리로 전달하면 URI 경로가 `.hwp`, `.hwpx` 또는 대문자 확장자로 끝날 때 후보에 표시한다.
Android 12 이상에서는 파일 이름에 점이 여러 개 있어도 처리한다. Android 11의 일반 MIME 보완 경로는 점 6개까지 지원한다.
형식도 일반 바이너리이고 URI에도 파일 이름이 없는 공급자는 Android가 HWP 여부를 구분할 수 없다.
이 경우 rHWP Fold → 열기로 선택한다. 전체 파일/사진/ZIP의 기본 앱으로 등록하지 않는다.

원리: [Android Intent 필터](https://developer.android.com/guide/topics/manifest/data-element).
확장자는 연결 후보를 고르는 힌트이며 실제 문서의 유효성은 편집 엔진이 검사한다.
한컴은 HWPX 내부의 MIME을 `application/hwp+zip`으로 설명한다
([한컴 개발자 포럼](https://forum.developer.hancom.com/t/hwp-hwpx-mime-type-whitelist/1641)).

## 개인 설치와 업데이트

```bash
# 첫 한 번만: JAVA_HOME은 JDK 17을 가리켜야 한다.
python3 rhwp-android/scripts/create-signing-key.py
rhwp-android/gradlew -p rhwp-android assembleRelease
python3 rhwp-android/scripts/pair-phone.py
```

페어링 후 설치 파일은 `rhwp-android/app/build/outputs/apk/release/app-release.apk`다.
검토용 전달본은 `rhwp-android/outputs/rHWP-Fold-0.1.0.apk`에 둔다.
휴대폰 주소가 바뀌면 `pair-phone.py --connect`로 기본 화면의 새 주소만 갱신한다.
`adb -s <연결된기기> install -r <APK>`에서 `-r`은 기존 앱의 데이터를 유지하는 업데이트 설치다.
개인 APK의 패키지는 `io.github.trayate_lang.rhwp`, 테스트 APK는 끝에 `.debug`가 붙어 함께 설치할 수 있다.

`.local/signing.properties`와 `.local/rhwp-fold-personal.jks`를 **함께 비공개 백업**한다.
키를 잃으면 기존 설치 위에 같은 서명으로 업데이트할 수 없다. 다음 배포 때 `versionCode`를 올린다.
서명키와 비밀번호, 폰 연결 정보는 GitHub Secrets를 포함해 외부에 업로드하지 않는다.

## 사용

- 아래의 **열기**로 HWP/HWPX를 선택한다. 문서는 서버에 업로드되지 않는다.
- **저장**은 Android 파일 공급자에 쓰고 다시 읽은 결과가 일치해야 완료된다. 취소·실패 시 수정 표시는 유지된다.
- **공유**는 현재 내용을 별도 사본으로 만든다. 공유창을 열었다고 원본 저장이 완료된 것은 아니다.
- **파일 → 인쇄/PDF**는 Android 인쇄 화면을 연다. PDF 저장을 선택하고 저장 위치를 지정한다.
- 접기·펼치기 때 같은 WebView를 유지한다. 폴드7에서 **설정 → 디스플레이 → 커버 화면에서 앱 계속 사용 → rHWP Fold**를 켜면 이어 쓰기 편하다.
- 자동복구는 입력이 잠시 멈춘 뒤, 주기적으로, 앱을 떠날 때 저장을 시도한다. 종료 직전 입력까지 보장하지 않고 **마지막으로 완료된 복구본**을 제공한다.

## 확인된 경계와 남은 검사

- 지원 파일 크기는 최대 128MiB다. 모든 크기의 문서에서 성능을 보장한다는 뜻은 아니다.
- 앱의 INTERNET 권한이 없고 원격 자산 요청을 차단한다. Android 파일 선택창의 클라우드 공급자는 별도 앱이므로 완전 오프라인 사용 시 기기 내부 파일을 선택한다.
- 공개 대체 글꼴을 포함한다. 원본 상용 글꼴과 줄바꿈·모양이 달라질 수 있다.
- 암호 문서는 원본의 암호 저장 경로를 사용한다. 평문 노출을 막기 위해 자동복구/즉시 공유가 제한된다.
- 인쇄 용지는 첫 쪽 크기로 초기화한다. 한 문서에 서로 다른 용지 크기가 섞인 경우 Android 인쇄 결과를 별도 확인해야 한다.
- 외부 파일 공급자의 장애는 완전히 원자적으로 되돌릴 수 없다. 저장 실패는 알리고 이전 사본 복원을 시도하며, 다른 이름 저장을 안내한다.
- 삼성 키보드 조합 중 전환, 실제 폴드7, 분할 화면, 큰 문서 성능은 `VALIDATION.md`의 검사 상태를 확인한다.

## GitHub에서 확인하기

- 개발 범위: [Issue #1](https://github.com/trayate-lang/rhwp-android/issues/1)
- 통합 브랜치: `android-main`, 구현 브랜치: `android/offline-editor`.
- `Actions → Android offline build`에서 웹 검사, Android 테스트와 APK 빌드 성공 여부를 확인한다.
- 실행 상세의 `Artifacts → android-verification-reports`에서 검사 보고서를 받는다.
- 공개 APK 배포는 이후 단계이므로 Actions에는 보고서만 업로드한다. 개인 서명 APK는 로컬에 둔다.
- 원본 workflow 21개는 `.github/upstream-workflows/`에 원문으로 보관해 실행하지 않는다.
# 0.1.1 상용구 시험판

- 문구를 드래그하거나 표·그림을 선택한 뒤 `Alt+i` 또는 **입력 → 상용구 등록/실행**을 누른다.
- 준말(공백 없이 1~10글자)을 입력한다. **글자 속성 유지**를 선택하면 본문 상용구, 해제하면 글자 상용구다. 표·그림은 본문 방식만 선택할 수 있다.
- 본문에 준말을 입력한 직후 `Alt+i` 또는 같은 메뉴를 실행하면 치환한다. `Ctrl+Z`로 준말까지 복원한다.
- `Ctrl+F3` 또는 **입력 → 상용구 내용**에서 항목을 선택하고 **확인**을 누르면 커서 위치에 넣는다. 목록에서 삭제할 수도 있다.
- 상용구는 기기의 별도 저장소에 남아 문서를 바꾸거나 앱을 다시 실행해도 사용할 수 있다. 앱 삭제/데이터 삭제 시에는 사라진다. 이 시험판에는 백업 내보내기가 아직 없다.

시험판은 기존 HTML 복사·붙이기를 재사용한다. 한컴 한글과 완전히 같은 보존 수준이나 IDO 파일 호환을 제공하지 않는다. 본문 글자와 그림을 섞은 상용구 삽입, 머리말·각주·글상자에서의 등록/삽입, 단독 그림의 표 셀 삽입은 안내 후 중단한다. 표 셀 안에서는 준말 실행 대신 목록의 넣기를 사용한다. 복잡한 개체·표 배치·그림 자르기 효과는 별도 검증 대상이다. 한 항목은 16MB까지 저장한다.
