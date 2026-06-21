import { printHelp, printVersion } from './help.js';
import { guidanceAudit } from './guidance-audit.js';
import { migrate } from './migrate.js';
import { sessionsList } from './sessions.js';
import { inboxCommand } from './inbox.js';
import { doctor } from './doctor.js';
import { mcpServe } from './mcp-server.js';
import { transcribeCommand } from './transcribe-cmd.js';
import { swarmCommand } from './swarm.js';
import { agentsCommand } from './agents-cmd.js';
import { hookCommand } from './hook-cmd.js';
import { replaceCommand } from './replace-ruflo.js';
import { memoryCommand } from './memory-cmd.js';
import { messagesCommand } from './messages.js';
import { transcriptsCommand } from './transcripts.js';
import { tasksCommand } from './tasks-cmd.js';
import { notesCommand } from './notes-cmd.js';
import { activityCommand } from './activity.js';
import { sessionCommand } from './terminal-attach.js';
import { setupCommand } from './setup.js';
import { exportCommand, importCommand } from './export.js';
import { logCommand } from './log-cmd.js';
import { completionsCommand } from './completions.js';
import { editCommand } from './edit-cmd.js';
import { adrCommand } from './auto-adr.js';
import { securityCommand } from './auto-security.js';

const COMMANDS = {
  help: () => printHelp(),
  '--help': () => printHelp(),
  '-h': () => printHelp(),
  version: () => printVersion(),
  '--version': () => printVersion(),
  '-v': () => printVersion(),
  guidance: guidanceDispatch,
  migrate: (args) => migrate(args),
  sessions: sessionsDispatch,
  inbox: inboxCommand,
  doctor: (args) => doctor(args),
  mcp: mcpDispatch,
  transcribe: transcribeCommand,
  swarm: swarmCommand,
  memory: memoryCommand,
  messages: messagesCommand,
  transcripts: transcriptsCommand,
  tasks: tasksCommand,
  notes: notesCommand,
  activity: activityCommand,
  session: sessionCommand,
  setup: setupCommand,
  export: exportCommand,
  import: importCommand,
  log: logCommand,
  completions: completionsCommand,
  edit: editCommand,
  agents: agentsCommand,
  hook: hookCommand,
  replace: replaceCommand,
  adr: adrCommand,
  security: securityCommand,
};

export async function run(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd) {
    printHelp();
    return;
  }
  const handler = COMMANDS[cmd];
  if (!handler) {
    console.error(`flo: unknown command '${cmd}'`);
    console.error(`Run 'flo help' to see available commands.`);
    process.exit(2);
  }
  await handler(rest);
}

async function guidanceDispatch(args) {
  const [sub, ...rest] = args;
  if (sub === 'audit') return guidanceAudit(rest);
  console.error(`flo guidance: unknown subcommand '${sub || '(none)'}'`);
  console.error(`Available: audit`);
  process.exit(2);
}

async function sessionsDispatch(args) {
  const [sub = 'list', ...rest] = args;
  if (sub === 'list') return sessionsList(rest);
  console.error(`flo sessions: unknown subcommand '${sub}'`);
  console.error(`Available: list`);
  process.exit(2);
}

async function mcpDispatch(args) {
  const [sub] = args;
  if (sub === 'start') return mcpServe();
  console.error(`flo mcp: unknown subcommand '${sub || '(none)'}'`);
  console.error(`Available: start`);
  process.exit(2);
}

