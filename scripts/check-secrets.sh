#!/bin/sh
# Fails if secrets or personal data appear in the given target.
#   scripts/check-secrets.sh --staged   → staged git changes (pre-commit hook)
#   scripts/check-secrets.sh <path>...  → files/directories (e.g. dist)
# Checks: (1) every value in .dev.vars except true/false, case-insensitive;
#         (2) known key formats; (3) email addresses outside an allowlist of placeholder domains.
set -eu
cd "$(dirname "$0")/.."

mode="${1:-}"
[ -n "$mode" ] || { echo "usage: $0 --staged | <path>..." >&2; exit 2; }

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

# Content to scan: staged diff (as text, binaries included) or the given paths.
if [ "$mode" = "--staged" ]; then
  git diff --cached --text -U0 >"$tmp"
else
  find "$@" -type f -exec cat {} + >"$tmp" 2>/dev/null || true
fi

found=0
report() { echo "BLOCKED: $1" >&2; found=1; }

# (1) exact .dev.vars values (one per line, quotes/CR stripped, spaces preserved)
if [ -f .dev.vars ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    name=${line%%=*}
    value=$(printf '%s' "${line#*=}" | tr -d '\r' | sed -e "s/^[\"'\`]//" -e "s/[\"'\`]$//")
    case "$value" in ''|true|false) continue ;; esac
    if grep -qiF -- "$value" "$tmp"; then report "value of $name from .dev.vars"; fi
  done <.dev.vars
else
  echo "warning: .dev.vars not found, only pattern checks run" >&2
fi

# (2) known secret formats (Google API keys, Cloudflare API tokens in env form, private keys)
if grep -qE 'AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|CLOUDFLARE_API_TOKEN=[A-Za-z0-9_-]{20,}' "$tmp"; then
  report "secret-looking pattern (API key / private key / token)"
fi

# (3) real email addresses (placeholders and git noreply are allowed)
if grep -oiE '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' "$tmp" \
  | grep -viE '@(example\.(com|org|net)|users\.noreply\.github\.com|anthropic\.com)$' \
  | grep -q .; then
  report "email address (use owner@example.com in code/tests, real values only in .dev.vars / secrets)"
fi

[ "$found" -eq 0 ] || exit 1
echo "OK: no secrets or personal data found ($mode)"
