const MAX_COMMAND_SUGGESTIONS = 6;
const SHELL_FENCE_LANGS = new Set([
  '',
  'bash',
  'sh',
  'shell',
  'zsh',
  'fish',
  'terminal',
  'console',
  'cmd',
  'powershell',
  'pwsh',
]);

// Matches explicit shell prompt prefixes inside fenced blocks (e.g. `$ cmd`,
// `user@host:~$ cmd`, `root@web:/var# cmd`, `PS C:\> cmd`).
const FENCED_PROMPT_RE = /^(?:(?:[\w.-]+@[\w.-]+(?::[^$#>\s]+)?)?[$#>]|PS\s+[^>]+>)\s+(.+)$/;

// Outside fenced code blocks, NEVER match bare `# ...` (Markdown heading) or
// bare `> ...` (Markdown blockquote). Require either `$ cmd`, `PS ...> cmd`,
// or a full `user@host[:path][$#>] cmd` prompt.
const UNFENCED_PROMPT_RE = /^\s*(?:[\w.-]+@[\w.-]+(?::[^$#>\s]+)?[$#>]|\$|PS\s+[^>]+>)\s+\S+/;

export function cleanCommandLine(line: string, inFence = true): string {
  const trimmed = line.trim();
  if (inFence) {
    // Inside a shell fence, `# ...` is a shell comment — do NOT strip `# ` as a prompt.
    if (trimmed.startsWith('#')) return trimmed;
    const match = FENCED_PROMPT_RE.exec(trimmed);
    return (match?.[1] ?? trimmed).trim();
  }
  const match = /^(?:[\w.-]+@[\w.-]+(?::[^$#>\s]+)?[$#>]|\$|PS\s+[^>]+>)\s+(.+)$/.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}

export function isCommandCandidate(line: string): boolean {
  if (!line || line.length > 260) return false;
  if (line.startsWith('#') || line.startsWith('//')) return false;
  if (/^(output|result|返回|输出|说明)[:：]/i.test(line)) return false;
  if (line.startsWith('```')) return false;
  return /^(?:sudo\s+)?(?:[A-Za-z0-9_./-]+)(?:\s|$)/.test(line);
}

function addCommandCandidate(
  commands: string[],
  seen: Set<string>,
  rawLine: string,
  inFence: boolean,
): void {
  const command = cleanCommandLine(rawLine, inFence);
  if (!isCommandCandidate(command) || seen.has(command)) return;
  seen.add(command);
  commands.push(command);
}

export function extractTerminalCommands(text: string): string[] {
  const commands: string[] = [];
  const seen = new Set<string>();
  const fenceRegex = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(text)) && commands.length < MAX_COMMAND_SUGGESTIONS) {
    const lang = match[1].trim().toLowerCase();
    if (!SHELL_FENCE_LANGS.has(lang)) continue;
    for (const line of match[2].split('\n')) {
      if (commands.length >= MAX_COMMAND_SUGGESTIONS) break;
      addCommandCandidate(commands, seen, line, true);
    }
  }

  // Strip fenced blocks before scanning prose lines so non-shell fences
  // (e.g. JSON/YAML/Python) are not re-scanned by the prompt heuristic.
  const withoutFences = text.replace(/```[^\n`]*\n[\s\S]*?```/g, '');
  for (const line of withoutFences.split('\n')) {
    if (commands.length >= MAX_COMMAND_SUGGESTIONS) break;
    if (UNFENCED_PROMPT_RE.test(line)) {
      addCommandCandidate(commands, seen, line, false);
    }
  }

  return commands;
}
