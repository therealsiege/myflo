import { printHelp, printVersion } from './help.js';
import { guidanceAudit } from './guidance-audit.js';
import { migrate } from './migrate.js';
import { sessionsList } from './sessions.js';
import { inboxCommand } from './inbox.js';
import { doctor } from './doctor.js';
import { mcpServe } from './mcp-server.js';
import { transcribeCommand } from './transcribe-cmd.js';
import { swarmStatusCommand } from './swarm.js';
import { memoryCommand } from './memory-cmd.js';
import { messagesCommand } from './messages.js';
import { transcriptsCommand } from './transcripts.js';
import { tasksCommand } from './tasks-cmd.js';

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
  swarm: swarmDispatch,
  memory: memoryCommand,
  messages: messagesCommand,
  transcripts: transcriptsCommand,
  tasks: tasksCommand,
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

async function swarmDispatch(args) {
  const [sub = 'status', ...rest] = args;
  if (sub === 'status') return swarmStatusCommand(rest);
  console.error(`flo swarm: unknown subcommand '${sub}'`);
  console.error(`Available: status`);
  process.exit(2);
}
