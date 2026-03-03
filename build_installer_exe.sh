#!/usr/bin/env bash
# Build dist/target-checkout-helper-installer.exe (Windows launcher)
# Requires: curl, tar, and Linux x86_64 host.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLS_DIR="$SCRIPT_DIR/.tools"
ZIG_DIR="$TOOLS_DIR/zig-linux-x86_64-0.13.0"
ZIG_BIN="$ZIG_DIR/zig"
DIST_DIR="$SCRIPT_DIR/dist"
SRC_FILE="$SCRIPT_DIR/installer/windows_installer.c"
OUT_FILE="$DIST_DIR/target-checkout-helper-installer.exe"
ZIP_FILE="$DIST_DIR/target-checkout-helper.zip"
INSTALL_HTML="$SCRIPT_DIR/INSTALL.html"

echo "==> Building Windows installer .exe"

if [[ ! -f "$ZIP_FILE" ]]; then
  echo "Missing $ZIP_FILE"
  echo "Generate or place target-checkout-helper.zip in dist/ first."
  exit 1
fi

if [[ ! -x "$ZIG_BIN" ]]; then
  echo "==> Downloading Zig 0.13.0 toolchain (one-time)..."
  mkdir -p "$TOOLS_DIR"
  TMP_TAR="$TOOLS_DIR/zig-linux-x86_64-0.13.0.tar.xz"
  curl -L --fail -o "$TMP_TAR" "https://ziglang.org/download/0.13.0/zig-linux-x86_64-0.13.0.tar.xz"
  tar -xf "$TMP_TAR" -C "$TOOLS_DIR"
fi

mkdir -p "$DIST_DIR"

echo "==> Compiling installer executable..."
"$ZIG_BIN" cc \
  -target x86_64-windows-gnu \
  -Os \
  -s \
  "$SRC_FILE" \
  -o "$OUT_FILE" \
  -luser32 \
  -lshell32 \
  -Wl,--subsystem,windows

echo "==> Copying INSTALL.html next to installer..."
cp "$INSTALL_HTML" "$DIST_DIR/INSTALL.html"

echo "==> Build complete:"
ls -lh "$OUT_FILE"
echo ""
echo "Distribute these files together to Windows users:"
echo "  - dist/target-checkout-helper-installer.exe"
echo "  - dist/target-checkout-helper.zip"
echo "  - dist/INSTALL.html"
