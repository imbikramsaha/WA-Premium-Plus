#!/bin/sh
# Installs WA Premium Plus on macOS or Linux:
#
#   curl -fsSL https://github.com/imbikramsaha/WA-Premium-Plus/releases/latest/download/install.sh | sh
#
# It picks the right download for this computer, checks it against the release's
# SHA256SUMS, installs it and starts the app.
#
# Options (environment variables):
#   WAPP_VERSION=0.4.2       install that version instead of the latest
#   WAPP_NO_LAUNCH=1         don't start the app after installing
#   WAPP_INSTALL_DIR=<dir>   macOS: where to put the app (default /Applications)
#   WAPP_FORMAT=appimage     Linux: use the AppImage even where a .deb would work
set -eu

REPO="imbikramsaha/WA-Premium-Plus"
APP="WA Premium Plus"

say() { printf '%s\n' "$*"; }
fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}
need() { command -v "$1" >/dev/null 2>&1 || fail "'$1' is required but not installed."; }

need curl
need uname

if [ -n "${WAPP_VERSION:-}" ]; then
  BASE="https://github.com/$REPO/releases/download/v${WAPP_VERSION#v}"
else
  BASE="https://github.com/$REPO/releases/latest/download"
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

fetch() { # url destination
  curl -fsSL --retry 3 -o "$2" "$1" || fail "couldn't download $1"
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

verify() { # file
  name=$(basename "$1")
  want=$(awk -v n="$name" '$2 == n || $2 == "*" n { print $1; exit }' "$TMP/SHA256SUMS")
  [ -n "$want" ] || fail "$name isn't listed in the release's SHA256SUMS."
  [ "$(sha256 "$1")" = "$want" ] || fail "$name doesn't match its checksum; the download may be corrupted. Please try again."
  say "Verified $name"
}

install_macos() {
  case "$ARCH" in
    arm64) A=arm64 ;;
    x86_64) A=x64 ;;
    *) fail "unsupported Mac processor: $ARCH" ;;
  esac
  # A Terminal running under Rosetta reports x86_64 on Apple silicon; use the native build.
  if [ "$A" = x64 ] && [ "$(sysctl -in hw.optional.arm64 2>/dev/null || true)" = 1 ]; then A=arm64; fi

  NAME="WA-Premium-Plus-mac-$A.dmg"
  say "Downloading $NAME..."
  fetch "$BASE/$NAME" "$TMP/$NAME"
  verify "$TMP/$NAME"

  MNT="$TMP/mnt"
  mkdir -p "$MNT"
  # macOS 27 replaces `hdiutil attach` with `diskutil image attach`; older systems lack it.
  if diskutil image attach --help >/dev/null 2>&1; then
    diskutil image attach --mountOptions nobrowse --readOnly --mountPoint "$MNT" "$TMP/$NAME" >/dev/null
  else
    hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MNT" "$TMP/$NAME" >/dev/null
  fi

  DEST="${WAPP_INSTALL_DIR:-/Applications}"
  if [ -z "${WAPP_INSTALL_DIR:-}" ] && [ ! -w "$DEST" ]; then DEST="$HOME/Applications"; fi
  mkdir -p "$DEST"

  # Quit a running copy so it can be replaced.
  if pgrep -f "$APP.app/Contents/MacOS/" >/dev/null 2>&1; then
    osascript -e "quit app \"$APP\"" >/dev/null 2>&1 || true
    sleep 2
  fi
  rm -rf "$DEST/$APP.app"
  ditto "$MNT/$APP.app" "$DEST/$APP.app"
  diskutil eject "$MNT" >/dev/null 2>&1 || hdiutil detach -force "$MNT" >/dev/null 2>&1 || true
  # curl doesn't mark downloads as quarantined, but clear the flag in case, so macOS
  # doesn't ask about the unsigned app.
  xattr -dr com.apple.quarantine "$DEST/$APP.app" 2>/dev/null || true

  say "Installed $DEST/$APP.app"
  if [ -z "${WAPP_NO_LAUNCH:-}" ]; then
    open "$DEST/$APP.app"
    say "$APP is starting. Scan the QR code with WhatsApp on your phone (Linked devices > Link a device)."
  fi
}

install_linux() {
  case "$ARCH" in
    x86_64 | amd64) AI=x64 DEB=amd64 ;;
    aarch64 | arm64) AI=arm64 DEB=arm64 ;;
    *) fail "unsupported processor: $ARCH" ;;
  esac

  if [ "${WAPP_FORMAT:-}" != appimage ] && command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1; then
    # Debian, Ubuntu and friends: a regular package, updated with the system.
    NAME="WA-Premium-Plus-linux-$DEB.deb"
    say "Downloading $NAME..."
    fetch "$BASE/$NAME" "$TMP/$NAME"
    verify "$TMP/$NAME"
    SUDO=""
    if [ "$(id -u)" -ne 0 ]; then
      need sudo
      SUDO=sudo
    fi
    chmod 644 "$TMP/$NAME"
    chmod 755 "$TMP"
    say "Installing the package (you may be asked for your password)..."
    $SUDO apt-get install -y "$TMP/$NAME" >/dev/null || fail "apt couldn't install the package."
    BIN=$(command -v wa-premium-plus 2>/dev/null || printf '%s' "/opt/$APP/wa-premium-plus")
    say "Installed $APP (run it from your applications menu or with: wa-premium-plus)"
  else
    # Any other distribution: an AppImage in your home folder, no root needed.
    NAME="WA-Premium-Plus-linux-$AI.AppImage"
    say "Downloading $NAME..."
    fetch "$BASE/$NAME" "$TMP/$NAME"
    verify "$TMP/$NAME"
    DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
    DIR="$DATA/wa-premium-plus"
    mkdir -p "$DIR" "$HOME/.local/bin" "$DATA/applications" "$DATA/icons/hicolor/512x512/apps"
    cp "$TMP/$NAME" "$DIR/WA-Premium-Plus.AppImage"
    chmod 755 "$DIR/WA-Premium-Plus.AppImage"
    ln -sf "$DIR/WA-Premium-Plus.AppImage" "$HOME/.local/bin/wa-premium-plus"
    curl -fsSL -o "$DATA/icons/hicolor/512x512/apps/wa-premium-plus.png" "$BASE/WA-Premium-Plus-icon.png" 2>/dev/null || true
    cat >"$DATA/applications/wa-premium-plus.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$APP
Comment=WhatsApp desktop app with message scheduling
Exec="$DIR/WA-Premium-Plus.AppImage" %U
Icon=wa-premium-plus
Terminal=false
Categories=Network;InstantMessaging;Chat;
StartupWMClass=$APP
EOF
    BIN="$DIR/WA-Premium-Plus.AppImage"
    say "Installed $BIN (run it from your applications menu or with: wa-premium-plus)"
    if ! command -v fusermount >/dev/null 2>&1 && ! command -v fusermount3 >/dev/null 2>&1; then
      say "Note: AppImages need FUSE. If the app doesn't start, install it (Ubuntu: sudo apt install libfuse2)."
    fi
  fi

  if [ -z "${WAPP_NO_LAUNCH:-}" ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    nohup "$BIN" >/dev/null 2>&1 &
    say "$APP is starting. Scan the QR code with WhatsApp on your phone (Linked devices > Link a device)."
  fi
}

say "Installing $APP..."
fetch "$BASE/SHA256SUMS" "$TMP/SHA256SUMS"

OS=$(uname -s)
ARCH=$(uname -m)
case "$OS" in
  Darwin) install_macos ;;
  Linux) install_linux ;;
  *) fail "this installer is for macOS and Linux. On Windows, use install.ps1 (see the README)." ;;
esac
