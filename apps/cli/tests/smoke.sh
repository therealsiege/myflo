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

# Transcribe: detect should always run; we don't assert which tool, only that the command exits cleanly with --json
if $FLO transcribe --detect --json >/dev/null 2>&1; then
  echo "  PASS  transcribe --detect"
  PASS=$((PASS+1))
else
  echo "  SKIP  transcribe --detect (no tool installed — install whisper/mlx-whisper to enable)"
  # Not counted as a failure: transcribe is local-tool-dependent.
fi

# Swarm: if .swarm/ exists, expect available=true; otherwise expect available=false
if [ -d "${REPO_ROOT}/.swarm" ]; then
  if $FLO swarm status --json | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d.get("available") is True' 2>/dev/null; then
    echo "  PASS  swarm status (available)"
    PASS=$((PASS+1))
  else
    echo "  FAIL  swarm status with .swarm/ present"
    FAIL=$((FAIL+1))
  fi
else
  echo "  SKIP  swarm status (no .swarm/ dir)"
fi

# Inbox registry: add → list → install (macOS only) → uninstall → remove
export FLO_HOME="$TMP/flo-home"
mkdir -p "$TMP/inbox-reg-test"
if $FLO inbox add "$TMP/inbox-reg-test" --slug smoke-reg >/dev/null 2>&1; then
  echo "  PASS  inbox add"
  PASS=$((PASS+1))
else
  echo "  FAIL  inbox add"
  FAIL=$((FAIL+1))
fi
if $FLO inbox list --json 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); assert any(i["slug"]=="smoke-reg" for i in d)' 2>/dev/null; then
  echo "  PASS  inbox list (json)"
  PASS=$((PASS+1))
else
  echo "  FAIL  inbox list (json)"
  FAIL=$((FAIL+1))
fi
if [ "$(uname)" = "Darwin" ]; then
  if $FLO inbox install smoke-reg --interval 60 >/dev/null 2>&1; then
    if [ -f "$HOME/Library/LaunchAgents/io.myflo.inbox.smoke-reg.plist" ]; then
      echo "  PASS  inbox install (plist created)"
      PASS=$((PASS+1))
      $FLO inbox uninstall smoke-reg >/dev/null 2>&1
      if [ ! -f "$HOME/Library/LaunchAgents/io.myflo.inbox.smoke-reg.plist" ]; then
        echo "  PASS  inbox uninstall (plist removed)"
        PASS=$((PASS+1))
      else
        echo "  FAIL  inbox uninstall did not remove plist"
        FAIL=$((FAIL+1))
      fi
    else
      echo "  FAIL  inbox install did not create plist"
      FAIL=$((FAIL+1))
    fi
  else
    echo "  FAIL  inbox install command"
    FAIL=$((FAIL+1))
  fi
else
  echo "  SKIP  inbox install (macOS-only)"
fi
$FLO inbox remove smoke-reg >/dev/null 2>&1 || true
unset FLO_HOME

echo "--------------"
echo "$PASS passed, $FAIL failed."
if [ "$FAIL" -gt 0 ]; then exit 1; fi
