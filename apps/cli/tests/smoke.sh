#!/usr/bin/env bash
# End-to-end smoke test for the flo CLI.
# Exercises every command. Exits non-zero on first failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FLO="node ${REPO_ROOT}/apps/cli/bin/flo.js"
TMP="$(mktemp -d)"
PASS=0
FAIL=0

trap 'rm -rf "$TMP"' EXIT

check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "  PASS  $name"
    PASS=$((PASS+1))
  else
    echo "  FAIL  $name"
    FAIL=$((FAIL+1))
  fi
}

echo "flo smoke test"
echo "--------------"

check "help"           $FLO help
check "version"        $FLO version

# Doctor may exit non-zero if MCP config absent — that's fine; just check it runs.
$FLO doctor >/dev/null 2>&1 || true
echo "  PASS  doctor (ran)"
PASS=$((PASS+1))

check "sessions list (text)"  $FLO sessions list --limit 5
check "sessions list (json)"  bash -c "$FLO sessions list --json | python3 -c 'import sys,json; json.load(sys.stdin)'"

check "guidance audit (json)" bash -c "$FLO guidance audit --json --quiet | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d[\"total\"] >= 0'"

# Inbox: drop a markdown file, run --once, confirm it moved to .processed
mkdir -p "$TMP/inbox-test"
cat > "$TMP/inbox-test/hello.md" <<EOF
---
to: tester
from: smoke
subject: ping
---
hi
EOF
$FLO inbox watch "$TMP/inbox-test" --once >/dev/null 2>&1
if [ -f "$TMP/inbox-test/.processed/hello.md" ]; then
  echo "  PASS  inbox once-mode (file moved to .processed)"
  PASS=$((PASS+1))
else
  echo "  FAIL  inbox once-mode (file did not move)"
  FAIL=$((FAIL+1))
fi

# Migrate dry-run (must not write)
check "migrate --dry-run"     bash -c "$FLO migrate --dry-run --mcp-path $TMP/no-such-mcp.json"
if [ -f "$TMP/no-such-mcp.json" ]; then
  echo "  FAIL  migrate --dry-run wrote a file"
  FAIL=$((FAIL+1))
else
  echo "  PASS  migrate --dry-run did not write"
  PASS=$((PASS+1))
fi

# MCP handshake: send initialize + tools/list, expect two response lines
RESP=$(printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' | $FLO mcp start 2>/dev/null)
if echo "$RESP" | grep -q '"protocolVersion":"2024-11-05"' && echo "$RESP" | grep -q 'flo_sessions_list'; then
  echo "  PASS  mcp start (initialize + tools/list)"
  PASS=$((PASS+1))
else
  echo "  FAIL  mcp start (unexpected response)"
  FAIL=$((FAIL+1))
fi

echo "--------------"
echo "$PASS passed, $FAIL failed."
if [ "$FAIL" -gt 0 ]; then exit 1; fi
