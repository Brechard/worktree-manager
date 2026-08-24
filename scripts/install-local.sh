#!/usr/bin/env bash
# Builds Worktree Manager for the current machine and installs it.
#
# Usage: ./scripts/install-local.sh [--no-install]
#   --no-install   build the installer only; don't copy the app to /Applications
set -euo pipefail

cd "$(dirname "$0")/.."

NO_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --no-install) NO_INSTALL=1 ;;
    *) echo "Unknown option: $arg (usage: $0 [--no-install])" >&2 && exit 1 ;;
  esac
done

case "$(uname -s)" in
  Darwin) TARGET_OS="mac" ;;
  Linux) TARGET_OS="linux" ;;
  MINGW* | MSYS* | CYGWIN*) TARGET_OS="win" ;;
  *)
    echo "Unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) ARCH="arm64" ;;
  x86_64 | amd64) ARCH="x64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

unset ELECTRON_RUN_AS_NODE

if command -v bun >/dev/null 2>&1; then
  PKG="bun"
elif command -v npm >/dev/null 2>&1; then
  PKG="npm"
else
  echo "Neither bun nor npm found on PATH. Install Bun from https://bun.sh first." >&2
  exit 1
fi

echo "==> Detected $TARGET_OS ($ARCH), using $PKG"

echo "==> Installing dependencies"
"$PKG" install

echo "==> Building packages"
"$PKG" run build

ROOT="$PWD"
EB=""
for candidate in \
  "$ROOT/apps/desktop/node_modules/.bin/electron-builder" \
  "$ROOT/node_modules/.bin/electron-builder"; do
  if [ -x "$candidate" ]; then EB="$candidate"; break; fi
done
if [ -z "$EB" ]; then EB="npx electron-builder"; fi

echo "==> Packaging for $TARGET_OS ($ARCH)"
(cd apps/desktop && "$EB" --"$TARGET_OS" --publish never)

RELEASE_DIR="apps/desktop/release"

find_artifact() {
  find "$RELEASE_DIR" \( -path "*-unpacked*" -o -name "*.blockmap" \) -prune -o \
    -name "$1" -type f -print 2>/dev/null | sort | head -n 1
}

case "$TARGET_OS" in
  mac)
    DMG="$(find_artifact '*.dmg')"
    APP_BUILT="$(find "$RELEASE_DIR" -maxdepth 2 -name 'Worktree Manager.app' -type d 2>/dev/null | head -n 1)"
    echo "==> Built $DMG"
    if [ "$NO_INSTALL" -eq 0 ] && [ -n "$APP_BUILT" ]; then
      rm -rf "/Applications/Worktree Manager.app"
      cp -R "$APP_BUILT" /Applications/
      echo "==> Installed to /Applications (built locally, no quarantine flag)"
      open "/Applications/Worktree Manager.app"
    elif [ -n "$APP_BUILT" ]; then
      echo "==> App bundle ready at: $APP_BUILT"
    fi
    ;;
  linux)
    APPIMAGE="$(find_artifact '*.AppImage')"
    chmod +x "$APPIMAGE"
    echo "==> Built $APPIMAGE"
    echo "    Run it with: \"$APPIMAGE\""
    ;;
  win)
    SETUP_EXE="$(find_artifact '*.exe')"
    echo "==> Built $SETUP_EXE"
    echo "    Run it to install."
    ;;
esac
