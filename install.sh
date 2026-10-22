#!/usr/bin/env bash
# Installs the JalaliTray4Gnome GNOME Shell extension for the current user.
#   ./install.sh            install or update
#   ./install.sh uninstall  remove it (the Vazirmatn font is left in place)
set -euo pipefail

UUID="jalali-calendar@jalalitray4gnome"
SRC="$(cd "$(dirname "$0")" && pwd)/$UUID"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
FONTS="${XDG_DATA_HOME:-$HOME/.local/share}/fonts"

if [[ "${1:-}" == "uninstall" ]]; then
    gnome-extensions disable "$UUID" 2>/dev/null || true
    rm -rf "$DEST"
    echo "Removed $DEST"
    exit 0
fi

command -v glib-compile-schemas >/dev/null || { echo "glib-compile-schemas is missing (package libglib2.0-bin)"; exit 1; }

# drop the pre-rename install
gnome-extensions disable jalali-calendar@zareh 2>/dev/null || true
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/jalali-calendar@zareh"

echo "Installing to $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$SRC"/. "$DEST"/
glib-compile-schemas "$DEST/schemas"

if ! fc-list 2>/dev/null | grep -qi vazirmatn; then
    echo "Installing the Vazirmatn font to $FONTS"
    mkdir -p "$FONTS"
    cp "$SRC"/fonts/Vazirmatn-*.ttf "$FONTS"/
    fc-cache -f "$FONTS" >/dev/null 2>&1 || true
fi

if [[ "${XDG_SESSION_TYPE:-}" == "x11" ]]; then
    echo "Restart GNOME Shell with Alt+F2, then r, Enter. Then run:"
else
    echo "Log out and back in (Wayland can't reload the shell), then run:"
fi
echo "  gnome-extensions enable $UUID"
echo "Optional: gnome-extensions disable shamsi-calendar@gnome.scr.ir"
