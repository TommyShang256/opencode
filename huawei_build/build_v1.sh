#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

BUN_EXEC=${BUN_BIN:-bun}
REGISTRY=${OPENCODE_BUILD_REGISTRY:-http://mirrors.tools.huawei.com/npm/}
LINKER=${OPENCODE_BUILD_LINKER:-hoisted}
MODE=${1:-server}

# Huawei builds use the private next channel and remain buildable from a source archive without .git.
if [ -z "${OPENCODE_CHANNEL:-}" ]; then
  OPENCODE_CHANNEL=next
  export OPENCODE_CHANNEL
fi
if [ -z "${OPENCODE_VERSION:-}" ]; then
  revision=$(git -C "$SOURCE_DIR" rev-parse --short=12 HEAD 2>/dev/null || printf archive)
  OPENCODE_VERSION="0.0.0-next-$revision"
  export OPENCODE_VERSION
fi

case "$MODE" in
  server)
    ;;
  package)
    ;;
  *)
    echo "Usage: sh huawei_build/build_v1.sh [package]" >&2
    exit 2
    ;;
esac

cd "$SOURCE_DIR"

run_build() {
  "$BUN_EXEC" --smol packages/server/script/build-standalone.ts \
    --install \
    --registry="$REGISTRY" \
    --linker="$LINKER" \
    --ignore-scripts \
    "$@"
}

huawei_artifacts() {
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  case "$os" in
    mingw* | msys* | cygwin*) os=windows ;;
  esac
  arch=$(uname -m)
  case "$arch" in
    x86_64 | amd64) arch=x64 ;;
    aarch64) arch=arm64 ;;
  esac

  target_dir="$SOURCE_DIR/packages/server/dist/server-$os-$arch"
  canonical_binary="$target_dir/bin/opencode2-server"
  if [ ! -f "$canonical_binary" ]; then
    echo "Missing standalone server artifact: $canonical_binary" >&2
    exit 1
  fi

  install -m 755 "$canonical_binary" "$SOURCE_DIR/packages/server/dist/cubecode-server"
  echo "=== 编译结果 ==="
  ls -lh "$SOURCE_DIR/packages/server/dist/cubecode-server"

  if [ "$MODE" != "package" ]; then
    return
  fi

  canonical_archive="$target_dir/opencode2-server-runtime.tar.gz"
  if [ ! -f "$canonical_archive" ]; then
    echo "Missing runtime package: $canonical_archive" >&2
    exit 1
  fi

  staging=$(mktemp -d "${TMPDIR:-/tmp}/cubecode2-server.XXXXXX")
  trap 'rm -rf "$staging"' EXIT HUP INT TERM
  tar xzf "$canonical_archive" -C "$staging"
  mv "$staging/bin/opencode2-server" "$staging/bin/cubecode-server"
  tar czf "$SOURCE_DIR/packages/server/dist/cubecode2-server.tar.gz" -C "$staging" .
  rm -rf "$staging"
  trap - EXIT HUP INT TERM

  echo "=== 打包结果 ==="
  ls -lh "$SOURCE_DIR/packages/server/dist/cubecode2-server.tar.gz"
}

if [ "$MODE" = "server" ]; then
  run_build
  huawei_artifacts
  exit 0
fi

RUNTIME_DIR=${OPENCODE_RUNTIME_CACHE_DIR:-/srv/datacube/opencode-huawei-v2/packages/server/runtime-cache}
RUNTIME_ZIP=${OPENCODE_RUNTIME_CACHE_ZIP:-/srv/datacube/runtime-cache.zip}

if [ ! -d "$RUNTIME_DIR" ]; then
  if [ ! -f "$RUNTIME_ZIP" ]; then
    echo "Missing runtime cache: $RUNTIME_DIR or $RUNTIME_ZIP" >&2
    exit 1
  fi

  first_entry=$(unzip -Z1 "$RUNTIME_ZIP" | sed -n '1p')
  case "$first_entry" in
    runtime-cache/* | ./runtime-cache/*)
      runtime_parent=$(dirname -- "$RUNTIME_DIR")
      mkdir -p "$runtime_parent"
      unzip -oq "$RUNTIME_ZIP" -d "$runtime_parent"
      ;;
    *)
      mkdir -p "$RUNTIME_DIR"
      unzip -oq "$RUNTIME_ZIP" -d "$RUNTIME_DIR"
      ;;
  esac
fi

run_build \
  --package-runtime \
  --runtime-cache="$RUNTIME_DIR"
huawei_artifacts
