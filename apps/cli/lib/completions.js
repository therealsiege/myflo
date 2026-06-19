// `flo completions <shell>` — emit autocomplete scripts for bash/zsh/fish.
// Static command list; users sourcing the output get tab completion.

const TOP_COMMANDS = [
  'help', 'version', 'guidance', 'migrate', 'sessions', 'inbox', 'doctor',
  'mcp', 'transcribe', 'swarm', 'memory', 'messages', 'transcripts',
  'tasks', 'notes', 'setup', 'export', 'import', 'log', 'completions',
  'session', 'activity', 'edit',
];

const SUBCOMMANDS = {
  guidance: ['audit'],
  sessions: ['list'],
  inbox: ['watch', 'status', 'add', 'list', 'remove', 'install', 'uninstall', 'help'],
  mcp: ['start'],
  swarm: ['status'],
  memory: ['store', 'search', 'list', 'get', 'delete', 'namespaces'],
  messages: ['list', 'read', 'archive', 'help'],
  transcripts: ['list'],
  tasks: ['create', 'list', 'update', 'complete', 'delete', 'get', 'counts'],
  notes: ['list', 'search'],
  session: ['terminal-add', 'terminal-list', 'terminal-remove', 'terminal-restore'],
  activity: ['list'],
  completions: ['bash', 'zsh', 'fish'],
};

export async function completionsCommand(args) {
  const [shell] = args;
  if (!shell || shell === '--help' || shell === '-h') return printHelp();
  if (shell === 'bash') return printBash();
  if (shell === 'zsh') return printZsh();
  if (shell === 'fish') return printFish();
  console.error(`flo completions: unknown shell '${shell}'. Try: bash, zsh, fish`);
  process.exit(2);
}

function printHelp() {
  console.log(`flo completions — emit shell autocomplete scripts

Usage:
  flo completions bash  >> ~/.bashrc                # or sourceable file
  flo completions zsh   >> ~/.zshrc                 # or to a fpath dir
  flo completions fish  > ~/.config/fish/completions/flo.fish

Each output is a complete, sourceable shell snippet. No runtime dependencies
beyond a working flo binary (uses the static command list, not introspection).
`);
}

function topWords() { return TOP_COMMANDS.sort().join(' '); }

function subcaseBash() {
  return Object.entries(SUBCOMMANDS)
    .map(([cmd, subs]) => `        ${cmd}) COMPREPLY=($(compgen -W "${subs.join(' ')}" -- "$cur")); return 0;;`)
    .join('\n');
}

function printBash() {
  console.log(`# flo bash completion. Source from .bashrc or save to /etc/bash_completion.d/flo
_flo() {
  local cur prev cmd
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmd="\${COMP_WORDS[1]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=($(compgen -W "${topWords()}" -- "$cur"))
    return 0
  fi
  if [ "$COMP_CWORD" -eq 2 ]; then
    case "$cmd" in
${subcaseBash()}
    esac
  fi
  return 0
}
complete -F _flo flo
`);
}

function subcaseZsh() {
  return Object.entries(SUBCOMMANDS)
    .map(([cmd, subs]) => `      ${cmd}) _values 'subcommand' ${subs.map((s) => `'${s}'`).join(' ')} ;;`)
    .join('\n');
}

function printZsh() {
  console.log(`#compdef flo
# flo zsh completion. Save to a directory in $fpath, e.g. ~/.zsh/completions/_flo
_flo() {
  local -a top
  top=(${TOP_COMMANDS.map((c) => `'${c}'`).join(' ')})
  if (( CURRENT == 2 )); then
    _values 'flo command' \${top[@]}
    return
  fi
  if (( CURRENT == 3 )); then
    case "\${words[2]}" in
${subcaseZsh()}
    esac
  fi
}
_flo "$@"
`);
}

function printFish() {
  // fish: emit one completion line per subcommand
  const lines = [];
  lines.push(`# flo fish completion. Save to ~/.config/fish/completions/flo.fish`);
  lines.push(`complete -c flo -f`);
  for (const cmd of TOP_COMMANDS) {
    lines.push(`complete -c flo -n '__fish_use_subcommand' -a '${cmd}'`);
  }
  for (const [cmd, subs] of Object.entries(SUBCOMMANDS)) {
    for (const sub of subs) {
      lines.push(`complete -c flo -n "__fish_seen_subcommand_from ${cmd}" -a '${sub}'`);
    }
  }
  console.log(lines.join('\n'));
}
