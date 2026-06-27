#!/usr/bin/env bash
#
# MAINTAINER / CI TOOL — not run by end users.
#
# Build a portable CPU whisper-cli for Linux x64 and package it as the release
# asset the app downloads on first run:
#
#     whisper-linux-bin-x64.zip
#
# CPU build on purpose: no GPU driver assumptions, runs on any x64 Linux box.
# Static libs (BUILD_SHARED_LIBS=OFF) so there are no whisper/ggml .so files to
# bundle; GGML_NATIVE=OFF avoids -march=native (would crash on other CPUs) and
# GGML_OPENMP=OFF drops the libgomp dependency. The result links only the base
# system libs (libc/libstdc++/libm) present on every distro.
#
# Build on an OLD distro (ubuntu-22.04) so the glibc requirement stays broad.
#
# Requirements: build-essential, cmake, git, zip.
#
# Usage:   ./scripts/build-linux-whisper.sh [whisper-version-tag]
# Example: ./scripts/build-linux-whisper.sh v1.7.6
set -euo pipefail

WHISPER_TAG="${1:-v1.7.6}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/.linux-build"
OUT="$ROOT/release/binaries"
ZIP="$OUT/whisper-linux-bin-x64.zip"

command -v cmake >/dev/null || { echo "cmake not found. Install build-essential cmake."; exit 1; }

echo "==> Building whisper-cli (CPU, static, portable) for linux/x64 from whisper.cpp ${WHISPER_TAG}"
rm -rf "$WORK"
git clone --depth 1 --branch "$WHISPER_TAG" https://github.com/ggerganov/whisper.cpp "$WORK"

cmake -S "$WORK" -B "$WORK/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_OPENMP=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=OFF

cmake --build "$WORK/build" --config Release -j"$(nproc)" --target whisper-cli

BIN="$WORK/build/bin/whisper-cli"
[ -f "$BIN" ] || { echo "Build produced no whisper-cli at $BIN"; exit 1; }

echo "==> Linked libraries (should be base system libs only):"
ldd "$BIN" || true

mkdir -p "$OUT"
rm -f "$ZIP"
( cd "$WORK/build/bin" && zip -j "$ZIP" whisper-cli )

echo
echo "==> Built: $ZIP"
echo "    Upload it to the release the app pulls from:"
echo "    gh release upload v1.0.0 \"$ZIP\" --repo Bernardo-Andreatta/Stradiz-Transcriber"
