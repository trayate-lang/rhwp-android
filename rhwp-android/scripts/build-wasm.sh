#!/usr/bin/env bash
# 호스트 폴더 공유 설정 없이도 동작하도록 필요한 소스만 Docker에 복사한다.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
docker build -t rhwp-fold-wasm:1.93.1 -f rhwp-android/Dockerfile.wasm-builder .
container="rhwp-fold-build-$$"
docker create --name "$container" -v rhwp-fold-cargo:/usr/local/cargo/registry \
  -v rhwp-fold-target:/app/target rhwp-fold-wasm:1.93.1 >/dev/null
trap 'docker rm -f "$container" >/dev/null' EXIT
# 토큰, .git, 개인 키, node_modules는 컨테이너에 전달하지 않는다.
COPYFILE_DISABLE=1 tar --no-xattrs -cf - Cargo.toml Cargo.lock build.rs rust-toolchain.toml LICENSE README.md \
  src crates examples tests saved/blank2010.hwp bindings/Native tools/rhwp-subsecond tools/batch-convert \
  tools/llm_verifier/verdict_protocol tools/llm_verifier/claim_bind tools/llm_verifier/criteria_decomp \
  scripts/wasm-pack-locked.sh mydocs/manual | docker cp - "$container:/app"
docker start -a "$container"
mkdir -p pkg
docker cp "$container:/app/pkg/." pkg/
test -s pkg/rhwp_bg.wasm
