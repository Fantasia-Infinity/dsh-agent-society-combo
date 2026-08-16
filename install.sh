#!/bin/sh
# dsh-agent-society-combo bootstrap installer (macOS / Linux / Git Bash).
#
# One-liner:
#   curl -fsSL https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.sh | bash
#
# With configuration passed through the environment:
#   DEEPSEEK_API_KEY=... COMBO_PRESET=anchored-standard \
#     curl -fsSL https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.sh | bash -s -- --root "$HOME/.local/share/dsh-agent-society-combo"
set -eu

COMBO_REPO="${COMBO_REPO:-https://github.com/Fantasia-Infinity/dsh-agent-society-combo.git}"
COMBO_REF="${COMBO_REF:-main}"
TMP_ROOT="${TMPDIR:-${TMP:-/tmp}}/dsh-agent-society-combo-install.$$"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT INT TERM

if ! command -v git >/dev/null 2>&1; then
  echo "git is required. Install git first." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.19 or newer is required. Install Node.js first." >&2
  exit 1
fi

NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22.19 or newer is required (found $(node --version))." >&2
  exit 1
fi

# Manual-clone mode: when this script itself lives inside a combo checkout,
# install from that checkout instead of downloading another copy.
case "$0" in
    */*) script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) ;;
    *) script_dir=$(pwd) ;;
esac
if [ -f "$script_dir/scripts/install.mjs" ] && [ -f "$script_dir/sources.lock.json" ]; then
    cd "$script_dir"
    exec node scripts/install.mjs "$@"
fi

mkdir -p "$TMP_ROOT"
git clone --quiet --depth 1 --branch "$COMBO_REF" "$COMBO_REPO" "$TMP_ROOT/combo"
cd "$TMP_ROOT/combo"
exec node scripts/install.mjs "$@"
