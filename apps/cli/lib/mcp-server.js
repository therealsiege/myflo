// MCP stdio server exposing flo capabilities as tools.
// Protocol: https://spec.modelcontextprotocol.io/specification/

import { createInterface } from 'node:readline';
import { readCheckpoints } from './sessions.js';
import { readSwarmState } from './swarm.js';
import {
  storeEntry,
  listEntries,
  searchEntries,
  namespaceStats,
} from './memory-store.js';
import { listInboxes } from './inbox-registry.js';
import { listAllMailboxes } from './messages.js';
import { transcribe, detectTool } from './transcribe.js';
import {
  createTask,
  updateTask,
  completeTask,
  listTasks,
  taskCounts,
} from './tasks-store.js';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'flo', version: '0.3.0' };

const TOOLS = [
  {
    name: 'flo_sessions_list',
    description: 'List Claude Code session checkpoints from .claude/checkpoints/ in the current project.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max results (default: 25)' } },
    },
  },
  {
    name: 'flo_guidance_audit',
    description: 'Scan ~/.claude/{skills,commands,agents}/ and project .claude/ for duplicate or undocumented capabilities. Returns markdown report.',
    inputSchema: {
      type: 'object',
      properties: { scope: { type: 'string', enum: ['all', 'user', 'project'] } },
    },
  },
  {
    name: 'flo_memory_store',
    description: 'Append an entry to flo memory (~/.flo/memory/<namespace>.jsonl). Returns the new entry with its id.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Entry value (required)' },
        key: { type: 'string', description: 'Optional human-readable key' },
        namespace: { type: 'string', description: 'Namespace (default: "default")' },
        tags: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object' },
      },
      required: ['value'],
    },
  },
  {
    name: 'flo_memory_search',
    description: 'Substring + tag search across flo memory namespaces. Returns scored matches.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        namespace: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'flo_memory_list',
    description: 'List the most recent entries in a flo memory namespace.',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Namespace (default: "default")' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'flo_memory_namespaces',
    description: 'List all flo memory namespaces with entry counts and last-entry timestamps.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flo_inbox_list',
    description: 'List registered flo inboxes from ~/.flo/inboxes.json with pending/processed/failed counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flo_messages_list',
    description: 'List inbox-bridged messages from ~/.flo/messages/<recipient>/. Returns one entry per recipient with their messages.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flo_swarm_status',
    description: 'Read .swarm/state.json and .swarm/q-learning-model.json from the project. Returns swarm objective, agent plan, and q-learning stats.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flo_transcribe',
    description: 'Transcribe a local audio file (m4a/wav/mp3/aiff/flac). Auto-detects mlx-whisper / openai-whisper / whisper-cpp. No cloud calls.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Absolute path to audio file' },
        model: { type: 'string', description: 'Whisper model (base/small/medium/large; default: base)' },
      },
      required: ['file'],
    },
  },
  {
    name: 'flo_transcribe_detect',
    description: 'Report which local transcription tool would be used (mlx-whisper / openai-whisper / whisper-cpp).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flo_tasks_create',
    description: 'Create a persistent task in flo. Survives across sessions. Stored in ~/.flo/tasks.jsonl.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        owner: { type: 'string' },
        parent: { type: 'string', description: 'Parent task id for subtasks' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
      },
      required: ['subject'],
    },
  },
  {
    name: 'flo_tasks_list',
    description: 'List flo tasks. Optional filters: status / owner / tag.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
        owner: { type: 'string' },
        tag: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'flo_tasks_update',
    description: 'Update a flo task. Can change status, subject, description, tags, owner.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        subject: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        owner: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
      },
      required: ['id'],
    },
  },
  {
    name: 'flo_tasks_complete',
    description: 'Mark a flo task as completed.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'flo_tasks_counts',
    description: 'Get counts of flo tasks by status.',
    inputSchema: { type: 'object', properties: {} },
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
  switch (name) {
    case 'flo_sessions_list': {
      const records = await readCheckpoints(undefined, typeof args.limit === 'number' ? args.limit : 25);
      return textResult(JSON.stringify(records, null, 2));
    }
    case 'flo_guidance_audit': {
      const { runAuditJson } = await loadAuditRunner();
      const json = await runAuditJson({ scope: args.scope || 'all' });
      return textResult(json);
    }
    case 'flo_memory_store': {
      if (!args.value) throw new Error('flo_memory_store: value is required');
      const entry = await storeEntry({
        namespace: args.namespace,
        key: args.key,
        value: args.value,
        tags: args.tags,
        metadata: args.metadata,
      });
      return textResult(JSON.stringify(entry, null, 2));
    }
    case 'flo_memory_search': {
      const results = await searchEntries({
        namespace: args.namespace,
        query: args.query || '',
        tags: args.tags || [],
        limit: typeof args.limit === 'number' ? args.limit : 20,
      });
      return textResult(JSON.stringify(results, null, 2));
    }
    case 'flo_memory_list': {
      const entries = await listEntries({
        namespace: args.namespace || 'default',
        limit: typeof args.limit === 'number' ? args.limit : 50,
      });
      return textResult(JSON.stringify(entries, null, 2));
    }
    case 'flo_memory_namespaces': {
      const stats = await namespaceStats();
      return textResult(JSON.stringify(stats, null, 2));
    }
    case 'flo_inbox_list': {
      const list = await listInboxes();
      return textResult(JSON.stringify(list, null, 2));
    }
    case 'flo_messages_list': {
      const list = await listAllMailboxes();
      return textResult(JSON.stringify(list, null, 2));
    }
    case 'flo_swarm_status': {
      const state = await readSwarmState();
      return textResult(JSON.stringify(state, null, 2));
    }
    case 'flo_transcribe': {
      if (!args.file) throw new Error('flo_transcribe: file is required');
      const result = await transcribe(args.file, { model: args.model });
      return textResult(JSON.stringify(result, null, 2));
    }
    case 'flo_transcribe_detect': {
      const tool = await detectTool();
      return textResult(JSON.stringify({ tool: tool?.name || null, binary: tool?.binary || null }));
    }
    case 'flo_tasks_create': {
      if (!args.subject) throw new Error('flo_tasks_create: subject is required');
      const task = await createTask(args);
      return textResult(JSON.stringify(task, null, 2));
    }
    case 'flo_tasks_list': {
      const tasks = await listTasks({
        status: args.status,
        owner: args.owner,
        tag: args.tag,
        limit: typeof args.limit === 'number' ? args.limit : 100,
      });
      return textResult(JSON.stringify(tasks, null, 2));
    }
    case 'flo_tasks_update': {
      if (!args.id) throw new Error('flo_tasks_update: id is required');
      const task = await updateTask(args);
      return textResult(JSON.stringify(task, null, 2));
    }
    case 'flo_tasks_complete': {
      if (!args.id) throw new Error('flo_tasks_complete: id is required');
      const task = await completeTask(args.id);
      return textResult(JSON.stringify(task, null, 2));
    }
    case 'flo_tasks_counts': {
      const counts = await taskCounts();
      return textResult(JSON.stringify(counts, null, 2));
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

async function loadAuditRunner() {
  // Spawn ourselves with `guidance audit --json --quiet` to reuse the markdown
  // renderer side. Uses execFile with an argument array (no shell).
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
