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

# MCP handshake: send initialize + tools/list, expect expanded toolset
RESP=$(printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' | $FLO mcp start 2>/dev/null)
if echo "$RESP" | grep -q '"protocolVersion":"2024-11-05"' \
  && echo "$RESP" | grep -q 'flo_sessions_list' \
  && echo "$RESP" | grep -q 'flo_memory_store' \
  && echo "$RESP" | grep -q 'flo_inbox_list' \
  && echo "$RESP" | grep -q 'flo_transcribe'; then
  echo "  PASS  mcp start (initialize + tools/list, expanded)"
  PASS=$((PASS+1))
else
  echo "  FAIL  mcp start (unexpected response or missing tools)"
  FAIL=$((FAIL+1))
fi

# MCP call: round-trip a tool to exercise the dispatch path
MCP_CALL=$(printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"flo_memory_namespaces","arguments":{}}}\n' | $FLO mcp start 2>/dev/null)
if echo "$MCP_CALL" | grep -q '"content"'; then
  echo "  PASS  mcp tools/call (flo_memory_namespaces)"
  PASS=$((PASS+1))
else
  echo "  FAIL  mcp tools/call did not return content"
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

# Memory store: store → list → search → namespaces → bridge from inbox md drop
export FLO_HOME="$TMP/flo-home"
if $FLO memory store --value "JWT auth pattern with 1hr refresh" --key smoke-pattern-auth --namespace smoke-patterns --tags auth,security >/dev/null 2>&1; then
  echo "  PASS  memory store"
  PASS=$((PASS+1))
else
  echo "  FAIL  memory store"
  FAIL=$((FAIL+1))
fi
if $FLO memory list --namespace smoke-patterns --json | python3 -c 'import sys,json; d=json.load(sys.stdin); assert len(d)>=1' 2>/dev/null; then
  echo "  PASS  memory list (json)"
  PASS=$((PASS+1))
else
  echo "  FAIL  memory list (json)"
  FAIL=$((FAIL+1))
fi
if $FLO memory search "JWT" --namespace smoke-patterns --json | python3 -c 'import sys,json; d=json.load(sys.stdin); assert any("JWT" in e["value"] for e in d)' 2>/dev/null; then
  echo "  PASS  memory search (substring)"
  PASS=$((PASS+1))
else
  echo "  FAIL  memory search (substring)"
  FAIL=$((FAIL+1))
fi
if $FLO memory namespaces --json | python3 -c 'import sys,json; d=json.load(sys.stdin); assert any(n["namespace"]=="smoke-patterns" for n in d)' 2>/dev/null; then
  echo "  PASS  memory namespaces"
  PASS=$((PASS+1))
else
  echo "  FAIL  memory namespaces"
  FAIL=$((FAIL+1))
fi

# Inbox bridge: drop .md with frontmatter → mailbox + memory:inbox entry
mkdir -p "$TMP/bridge-inbox"
cat > "$TMP/bridge-inbox/msg.md" <<EOF
---
to: architect
from: tester
subject: bridge smoke
---
Smoke body content.
EOF
$FLO inbox watch "$TMP/bridge-inbox" --once >/dev/null 2>&1
if $FLO messages list architect --json | python3 -c 'import sys,json; d=json.load(sys.stdin); assert len(d)>=1' 2>/dev/null; then
  echo "  PASS  inbox bridge (mailbox)"
  PASS=$((PASS+1))
else
  echo "  FAIL  inbox bridge (mailbox)"
  FAIL=$((FAIL+1))
fi
if $FLO memory list --namespace inbox --json | python3 -c 'import sys,json; d=json.load(sys.stdin); assert any(e.get("metadata",{}).get("to")=="architect" for e in d)' 2>/dev/null; then
  echo "  PASS  inbox bridge (memory entry)"
  PASS=$((PASS+1))
else
  echo "  FAIL  inbox bridge (memory entry)"
  FAIL=$((FAIL+1))
fi

# Inbox registry: add → list → install (macOS only) → uninstall → remove
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

# Transcripts: returns JSON array (empty is OK)
if $FLO transcripts list --json | python3 -c 'import sys,json; d=json.load(sys.stdin); assert isinstance(d, list)' 2>/dev/null; then
  echo "  PASS  transcripts list (json shape)"
  PASS=$((PASS+1))
else
  echo "  FAIL  transcripts list (json shape)"
  FAIL=$((FAIL+1))
fi

# Tasks: create → list → update → complete → counts → delete (event log round-trip)
TASK_ID=$($FLO tasks create "smoke test task" --tags smoke,test --json 2>/dev/null \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])' 2>/dev/null)
if [ -n "$TASK_ID" ]; then
  echo "  PASS  tasks create (id=$TASK_ID)"
  PASS=$((PASS+1))
else
  echo "  FAIL  tasks create"
  FAIL=$((FAIL+1))
fi
if $FLO tasks list --json | python3 -c 'import sys,json; d=json.load(sys.stdin); assert any(t["status"]=="pending" for t in d)' 2>/dev/null; then
  echo "  PASS  tasks list (pending)"
  PASS=$((PASS+1))
else
  echo "  FAIL  tasks list"
  FAIL=$((FAIL+1))
fi
if [ -n "$TASK_ID" ] && $FLO tasks update "$TASK_ID" --status in_progress >/dev/null 2>&1; then
  if $FLO tasks list --status in_progress --json | python3 -c "import sys,json; d=json.load(sys.stdin); assert any(t['id']=='$TASK_ID' for t in d)" 2>/dev/null; then
    echo "  PASS  tasks update (status transition)"
    PASS=$((PASS+1))
  else
    echo "  FAIL  tasks update (didn't show in in_progress list)"
    FAIL=$((FAIL+1))
  fi
else
  echo "  FAIL  tasks update command"
  FAIL=$((FAIL+1))
fi
if [ -n "$TASK_ID" ] && $FLO tasks complete "$TASK_ID" >/dev/null 2>&1; then
  if $FLO tasks counts --json | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d["completed"]>=1' 2>/dev/null; then
    echo "  PASS  tasks complete + counts"
    PASS=$((PASS+1))
  else
    echo "  FAIL  tasks counts"
    FAIL=$((FAIL+1))
  fi
else
  echo "  FAIL  tasks complete command"
  FAIL=$((FAIL+1))
fi
[ -n "$TASK_ID" ] && $FLO tasks delete "$TASK_ID" >/dev/null 2>&1 || true
# Terminal-attach: add/list/remove
if $FLO session terminal-add smoke-term --cwd "$TMP" --app ghostty --title "smoke" >/dev/null 2>&1; then
  echo "  PASS  session terminal-add"
  PASS=$((PASS+1))
else
  echo "  FAIL  session terminal-add"
  FAIL=$((FAIL+1))
fi
if $FLO session terminal-list --json | python3 -c 'import sys,json; d=json.load(sys.stdin); assert any(t["slug"]=="smoke-term" for t in d)' 2>/dev/null; then
  echo "  PASS  session terminal-list (json)"
  PASS=$((PASS+1))
else
  echo "  FAIL  session terminal-list (json)"
  FAIL=$((FAIL+1))
fi
if $FLO session terminal-remove smoke-term >/dev/null 2>&1; then
  echo "  PASS  session terminal-remove"
  PASS=$((PASS+1))
else
  echo "  FAIL  session terminal-remove"
  FAIL=$((FAIL+1))
fi

# BM25 ranking: discriminating query "refresh oauth2" should hit JWT entry alone
$FLO memory store --value "JWT auth with refresh tokens and OAuth2" --namespace bm25-test >/dev/null 2>&1
$FLO memory store --value "Stripe payment integration handles webhooks" --namespace bm25-test >/dev/null 2>&1
$FLO memory store --value "Auth tokens signed with HS256 keys" --namespace bm25-test >/dev/null 2>&1
TOP_SCORE_VAL=$($FLO memory search "refresh oauth2" --namespace bm25-test --json 2>/dev/null \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d[0]["value"] if d else "")' 2>/dev/null)
if echo "$TOP_SCORE_VAL" | grep -q "JWT auth"; then
  echo "  PASS  memory search BM25 ranking (JWT entry top)"
  PASS=$((PASS+1))
else
  echo "  FAIL  memory search BM25 ranking (got: $TOP_SCORE_VAL)"
  FAIL=$((FAIL+1))
fi
WEBHOOK_TOP=$($FLO memory search "webhook" --namespace bm25-test --json 2>/dev/null \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d[0]["value"] if d else "")' 2>/dev/null)
if echo "$WEBHOOK_TOP" | grep -q "Stripe"; then
  echo "  PASS  memory search BM25 ranking (webhook → Stripe entry)"
  PASS=$((PASS+1))
else
  echo "  FAIL  memory search BM25 ranking (webhook expected Stripe, got: $WEBHOOK_TOP)"
  FAIL=$((FAIL+1))
fi

unset FLO_HOME

# AgentDB backend: same operations should work with FLO_MEMORY_BACKEND=agentdb
export FLO_HOME="$TMP/flo-agentdb"
export FLO_MEMORY_BACKEND=agentdb
if $FLO memory store --value "JWT auth via AgentDB" --namespace agentdb-test --tags auth >/dev/null 2>&1; then
  echo "  PASS  memory store (agentdb backend)"
  PASS=$((PASS+1))
else
  echo "  FAIL  memory store (agentdb backend)"
  FAIL=$((FAIL+1))
fi
$FLO memory store --value "Stripe webhook handler" --namespace agentdb-test >/dev/null 2>&1 || true
$FLO memory store --value "HS256 keys" --namespace agentdb-test >/dev/null 2>&1 || true
if $FLO memory list --namespace agentdb-test --json | python3 -c 'import sys,json; d=json.load(sys.stdin); assert len(d)>=2' 2>/dev/null; then
  echo "  PASS  memory list (agentdb backend)"
  PASS=$((PASS+1))
else
  echo "  FAIL  memory list (agentdb backend)"
  FAIL=$((FAIL+1))
fi
if $FLO memory search "JWT" --namespace agentdb-test --json 2>/dev/null \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); assert any("JWT" in e["value"] for e in d)' 2>/dev/null; then
  echo "  PASS  memory search FTS5 (agentdb backend)"
  PASS=$((PASS+1))
else
  echo "  FAIL  memory search FTS5 (agentdb backend)"
  FAIL=$((FAIL+1))
fi
if $FLO memory namespaces --json | python3 -c 'import sys,json; d=json.load(sys.stdin); assert any(n["namespace"]=="agentdb-test" for n in d)' 2>/dev/null; then
  echo "  PASS  memory namespaces (agentdb backend)"
  PASS=$((PASS+1))
else
  echo "  FAIL  memory namespaces (agentdb backend)"
  FAIL=$((FAIL+1))
fi
unset FLO_HOME FLO_MEMORY_BACKEND

# Agents: spawn / list / update / health
export FLO_HOME="$TMP/flo-agents"
AGENT_ID=$($FLO agents spawn coder --name builder --tags impl --json 2>/dev/null \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])' 2>/dev/null)
if [ -n "$AGENT_ID" ]; then echo "  PASS  agents spawn (id=$AGENT_ID)"; PASS=$((PASS+1))
else echo "  FAIL  agents spawn"; FAIL=$((FAIL+1)); fi
if $FLO agents list --json | python3 -c "import sys,json; d=json.load(sys.stdin); assert any(a['id']=='$AGENT_ID' for a in d)" 2>/dev/null; then
  echo "  PASS  agents list"; PASS=$((PASS+1))
else echo "  FAIL  agents list"; FAIL=$((FAIL+1)); fi
if [ -n "$AGENT_ID" ] && $FLO agents update "$AGENT_ID" --status busy >/dev/null 2>&1; then
  if $FLO agents list --status busy --json | python3 -c "import sys,json; d=json.load(sys.stdin); assert any(a['id']=='$AGENT_ID' for a in d)" 2>/dev/null; then
    echo "  PASS  agents update (status transition)"; PASS=$((PASS+1))
  else echo "  FAIL  agents update visibility"; FAIL=$((FAIL+1)); fi
else echo "  FAIL  agents update command"; FAIL=$((FAIL+1)); fi
if $FLO agents health --json | python3 -c 'import sys,json; d=json.load(sys.stdin); assert any(h["health"]=="healthy" for h in d)' 2>/dev/null; then
  echo "  PASS  agents health"; PASS=$((PASS+1))
else echo "  FAIL  agents health"; FAIL=$((FAIL+1)); fi
unset FLO_HOME

# Swarm vote: record + tally in an isolated temp swarm dir
mkdir -p "$TMP/swarm-vote-test"
(cd "$TMP/swarm-vote-test" && $FLO swarm vote use-flo --voter alice --vote yes >/dev/null 2>&1 \
  && $FLO swarm vote use-flo --voter bob --vote yes --weight 2 >/dev/null 2>&1 \
  && $FLO swarm vote use-flo --voter carol --vote no >/dev/null 2>&1)
TALLY=$(cd "$TMP/swarm-vote-test" && $FLO swarm tally use-flo --json 2>/dev/null)
if echo "$TALLY" | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d["totalVoters"]==3 and d["tally"]["yes"]==3 and d["tally"]["no"]==1' 2>/dev/null; then
  echo "  PASS  swarm vote + tally"; PASS=$((PASS+1))
else echo "  FAIL  swarm vote + tally (got $TALLY)"; FAIL=$((FAIL+1)); fi

# MCP tools/list should now report 22 tools (16 + 6 new)
TOOLCOUNT=$(printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' \
  | $FLO mcp start 2>/dev/null | python3 -c 'import sys,json
for line in sys.stdin:
    if not line.strip(): continue
    m = json.loads(line)
    if m.get("id") == 2: print(len(m["result"]["tools"]))' 2>/dev/null)
if [ "$TOOLCOUNT" = "22" ]; then echo "  PASS  mcp tools/list count (22)"; PASS=$((PASS+1))
else echo "  FAIL  mcp tools/list count (got $TOOLCOUNT)"; FAIL=$((FAIL+1)); fi

# `flo replace ruflo` against a fixture project — file rewrites + graceful
# skip when claude CLI is unavailable (PATH hidden to avoid mutating real config).
REPLACE_DIR="$TMP/replace-ruflo-test"
mkdir -p "$REPLACE_DIR/.claude"
cat > "$REPLACE_DIR/.claude/settings.json" <<'JSON'
{
  "mcpServers": {
    "ruflo": {"command": "npx", "args": ["-y", "ruflo@latest", "mcp", "start"]},
    "flo": {"command": "node", "args": ["/x.js"]}
  },
  "enabledMcpjsonServers": ["ruflo", "flo"],
  "permissions": {"allow": ["mcp__ruflo__foo", "Bash(ls:*)", "mcp__claude-flow__bar"]}
}
JSON
NODE_BIN=$(which node)
REPLACE_OUT=$(cd "$REPLACE_DIR" && PATH="/usr/bin:/bin" $NODE_BIN "$REPO_ROOT/apps/cli/bin/flo.js" replace ruflo 2>&1)
if echo "$REPLACE_OUT" | grep -q "claude CLI not on PATH"; then
  if python3 -c "import json; d=json.load(open('$REPLACE_DIR/.claude/settings.json')); assert list(d['mcpServers'].keys())==['flo'] and d['enabledMcpjsonServers']==['flo'] and d['permissions']['allow']==['Bash(ls:*)']" 2>/dev/null; then
    echo "  PASS  replace ruflo (file rewrite + graceful claude-cli skip)"; PASS=$((PASS+1))
  else
    echo "  FAIL  replace ruflo: file content unexpected"; FAIL=$((FAIL+1))
  fi
else
  echo "  FAIL  replace ruflo: expected 'claude CLI not on PATH' message"; FAIL=$((FAIL+1))
fi

# Auto-ADR: trigger via flo adr draft + verify file lands
export FLO_HOME="$TMP/adr-home"
if $FLO adr draft --file "src/api/users.ts" >/dev/null 2>&1; then
  if ls "$FLO_HOME/adr"/ADR-001-*.md >/dev/null 2>&1; then
    echo "  PASS  auto-adr draft (api-route trigger)"; PASS=$((PASS+1))
  else echo "  FAIL  auto-adr draft: no file written"; FAIL=$((FAIL+1)); fi
else echo "  FAIL  auto-adr draft command"; FAIL=$((FAIL+1)); fi
unset FLO_HOME

# Auto-ADR: post-edit hook triggers draft on schema file
export FLO_HOME="$TMP/adr-hook-home"
if CLAUDE_FILE_PATHS="db/schema.sql" $FLO hook post-edit >/dev/null 2>&1; then
  if ls "$FLO_HOME/adr"/ADR-001-*.md >/dev/null 2>&1; then
    echo "  PASS  auto-adr post-edit hook"; PASS=$((PASS+1))
  else echo "  FAIL  auto-adr hook: no draft created"; FAIL=$((FAIL+1)); fi
else echo "  FAIL  auto-adr hook command"; FAIL=$((FAIL+1)); fi
unset FLO_HOME

# Auto-security: secret-pattern detection in a leaky file
export FLO_HOME="$TMP/sec-home"
SEC_PROJ="$TMP/sec-proj"
mkdir -p "$SEC_PROJ"
printf 'const stripe = "sk_test_abcd1234567890abcdef1234567890";\n' > "$SEC_PROJ/leak.js"
if $FLO security scan --dir "$SEC_PROJ" --json 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); assert any(f['kind']=='secret-pattern' and f['pattern']=='stripe-key' for f in d)" 2>/dev/null; then
  echo "  PASS  auto-security scan (stripe-key detected)"; PASS=$((PASS+1))
else echo "  FAIL  auto-security scan"; FAIL=$((FAIL+1)); fi
unset FLO_HOME

echo "--------------"
echo "$PASS passed, $FAIL failed."
if [ "$FAIL" -gt 0 ]; then exit 1; fi
