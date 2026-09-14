#!/usr/bin/env bash
# WASM과 Studio를 같은 checkout에서 빌드하고 모든 리소스를 APK 안에 넣는다.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
test -s pkg/rhwp_bg.wasm || { echo '먼저 rhwp-android/scripts/build-wasm.sh를 실행하세요.' >&2; exit 1; }
cp pkg/rhwp_bg.wasm rhwp-studio/public/rhwp_bg.wasm
cd rhwp-studio
RHWP_ANDROID=1 RHWP_DISABLE_EXTERNAL_WEBFONTS=1 npm run build -- --base=./
# PWA 캐시나 외부 CDN 없이도 실행할 필수 자산을 확인한다.
test -s dist/rhwp_bg.wasm
test -d dist/fonts
