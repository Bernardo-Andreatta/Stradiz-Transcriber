#!/usr/bin/env bash
#
# MAINTAINER / CI TOOL — not run by end users.
#
# Build a single UNIVERSAL whisper-cli for macOS (arm64 + x86_64) with the Metal
# GPU backend, and package it as the release asset the app downloads on first run:
#
#     whisper-metal-bin-universal.zip
#
# Run this once on an Apple Silicon Mac, upload the zip to the GitHub release, and
# from then on every Mac user's in-app Setup downloads it automatically — exactly
# like the Windows Vulkan build. The end user never runs this script.
#
# How it stays self-contained: static build (BUILD_SHARED_LIBS=OFF) with the Metal
# shader library embedded (GGML_METAL_EMBED_LIBRARY=ON), so the binary depends only
# on system frameworks present on every Mac. We build each arch separately (Apple
# Silicon cross-compiles x86_64 — no Intel hardware needed) and lipo them into one
# universal binary, which is more reliable than a single universal cmake pass.
#
# Requirements: Xcode Command Line Tools + cmake (`brew install cmake`).
#
# Usage:   ./scripts/build-mac-whisper.sh [whisper-version-tag]
# Example: ./scripts/build-mac-whisper.sh v1.7.6
set -euo pipefail

WHISPER_TAG="${1:-v1.7.6}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/.mac-build"
SRC="$WORK/whisper.cpp"
OUT="$ROOT/release/binaries"
ZIP="$OUT/whisper-metal-bin-universal.zip"

command -v cmake >/dev/null || { echo "cmake not found. Run: brew install cmake"; exit 1; }

echo "==> Building universal whisper-cli (Metal, static) from whisper.cpp ${WHISPER_TAG}"
rm -rf "$WORK"
mkdir -p "$WORK"
git clone --depth 1 --branch "$WHISPER_TAG" https://github.com/ggerganov/whisper.cpp "$SRC"

# Build one arch into its own tree and echo the path to the produced binary.
build_arch() {
  local arch="$1"                       # arm64 | x86_64
  local bdir="$WORK/build-$arch"
  echo "==> [$arch] configuring + building" >&2
  cmake -S "$SRC" -B "$bdir" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_OSX_ARCHITECTURES="$arch" \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_METAL=ON \
    -DGGML_METAL_EMBED_LIBRARY=ON \
    -DGGML_NATIVE=OFF \
    -DWHISPER_BUILD_EXAMPLES=ON \
    -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_BUILD_SERVER=OFF >&2
  cmake --build "$bdir" --config Release -j"$(sysctl -n hw.ncpu)" --target whisper-cli >&2
  echo "$bdir/bin/whisper-cli"
}

ARM_BIN="$(build_arch arm64)"
X64_BIN="$(build_arch x86_64)"
[ -f "$ARM_BIN" ] && [ -f "$X64_BIN" ] || { echo "One arch failed to build"; exit 1; }

echo "==> Fusing into a universal binary with lipo"
UNI="$WORK/whisper-cli"
lipo -create -output "$UNI" "$ARM_BIN" "$X64_BIN"
chmod +x "$UNI"

echo "==> lipo -info:"; lipo -info "$UNI"
echo "==> Linked libraries (system frameworks + libc++ only):"; otool -L "$UNI"

mkdir -p "$OUT"
rm -f "$ZIP"
( cd "$WORK" && zip -j "$ZIP" whisper-cli )

echo
echo "==> Built universal asset: $ZIP"
echo "    Host it on the release so the installer auto-downloads it (like Vulkan):"
echo
echo "    gh release upload v1.0.0 \"$ZIP\" --repo Bernardo-Andreatta/Stradiz-Transcriber"
