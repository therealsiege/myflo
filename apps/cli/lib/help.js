import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function printHelp() {
  console.log(`flo — local-first developer workbench

Usage:
  flo <command> [options]

Commands:
  guidance audit              Scan ~/.claude/{skills,commands,agents}/ and project
                              .claude/ for duplicate, missing-description, or
                              orphan capabilities. Output: markdown report.
  migrate                     Rewrite ~/.claude/mcp.json to register 'flo' as an
                              MCP server. Idempotent. Backs up first.
  sessions list               List Claude Code session checkpoints in
                              .claude/checkpoints/ for the current project.
  inbox watch <dir>           Watch a folder for drops. Markdown frontmatter routes
                              to memory/SendMessage; .m4a/.wav/.mp3 routes to
                              transcribe handler. (Foreground mode; no launchd yet.)
  inbox status                Show registered inbox handlers and recent activity.
  doctor                      Quick health check: Node, git, .claude dir,
                              checkpoints, MCP config.
  help, -h, --help            Show this help.
  version, -v, --version      Show flo version.

Environment:
  FLO_DEBUG=1                 Print stack traces on error.
  FLO_HOME=<path>             Override ~/.flo (default).

Docs: https://github.com/therealsiege/myflo
`);
}

export function printVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    console.log(`flo ${pkg.version}`);
  } catch {
    console.log('flo (unknown version)');
  }
}
