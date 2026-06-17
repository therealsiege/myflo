// Minimal MCP stdio server exposing flo capabilities as tools.
// Protocol: https://spec.modelcontextprotocol.io/specification/

import { createInterface } from 'node:readline';
import { readCheckpoints } from './sessions.js';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'flo', version: '0.1.0' };

const TOOLS = [
  {
    name: 'flo_sessions_list',
    description: 'List Claude Code session checkpoints from .claude/checkpoints/ in the current project.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default: 25)' },
      },
    },
  },
  {
    name: 'flo_guidance_audit',
    description: 'Scan ~/.claude/{skills,commands,agents}/ and project .claude/ for duplicate or undocumented capabilities. Returns markdown report.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['all', 'user', 'project'], description: 'Scope filter (default: all)' },
      },
    },
  },
];

export async function mcpServe() {
  const rl = createInterface({ input: process.stdin });
  const inFlight = new Set();
  let stdinClosed = false;

  rl.on('line', (line) => {
    if (!line.trim()) return;
    const task = (async () => {
      let req;
      try { req = JSON.parse(line); }
      catch { return send(null, null, { code: -32700, message: 'parse error' }); }
      try {
        const result = await handle(req);
        if (req.id !== undefined && req.id !== null) {
          send(req.id, result, null);
        }
      } catch (err) {
        send(req?.id ?? null, null, { code: -32603, message: err.message || String(err) });
      }
    })();
    inFlight.add(task);
    task.finally(() => {
      inFlight.delete(task);
      if (stdinClosed && inFlight.size === 0) process.exit(0);
    });
  });

  rl.on('close', () => {
    stdinClosed = true;
    if (inFlight.size === 0) process.exit(0);
  });
}

async function handle(req) {
  switch (req.method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call':
      return await callTool(req.params);
    case 'ping':
      return {};
    default:
      throw new Error(`method not implemented: ${req.method}`);
  }
}

async function callTool({ name, arguments: args = {} }) {
  if (name === 'flo_sessions_list') {
    const limit = typeof args.limit === 'number' ? args.limit : 25;
    const records = await readCheckpoints(undefined, limit);
    return { content: [{ type: 'text', text: JSON.stringify(records, null, 2) }] };
  }
  if (name === 'flo_guidance_audit') {
    // Lazy import to avoid pulling guidance-audit into MCP startup path
    const { runAuditJson } = await loadAuditRunner();
    const json = await runAuditJson({ scope: args.scope || 'all' });
    return { content: [{ type: 'text', text: json }] };
  }
  throw new Error(`unknown tool: ${name}`);
}

async function loadAuditRunner() {
  // Spawn ourselves with `guidance audit --json --quiet` to keep audit logic in
  // one place. Uses execFile with an argument array (no shell) for safety.
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  return {
    async runAuditJson({ scope }) {
      const binPath = new URL('../bin/flo.js', import.meta.url).pathname;
      const args = ['guidance', 'audit', '--json', '--quiet'];
      if (scope && scope !== 'all') args.push('--scope', scope);
      const { stdout } = await execFileAsync(process.execPath, [binPath, ...args], {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 30_000,
      });
      return stdout;
    },
  };
}

function send(id, result, error) {
  const msg = { jsonrpc: '2.0', id };
  if (error) msg.error = error;
  else msg.result = result;
  process.stdout.write(JSON.stringify(msg) + '\n');
}
