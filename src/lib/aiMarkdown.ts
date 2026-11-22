import type { CommandRiskLevel } from '../types/agent';

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'blockquote'; text: string }
  | {
      type: 'code';
      lang: string;
      code: string;
      isShell: boolean;
      runnableCommand: string;
      risk: CommandRiskLevel;
    };

export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string };

const SHELL_LANGS = new Set([
  '',
  'sh',
  'bash',
  'zsh',
  'fish',
  'shell',
  'console',
  'terminal',
  'cmd',
  'powershell',
  'pwsh',
]);

const HIGH_RISK_PATTERNS: RegExp[] = [
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r/i,
  /\brm\s+-rf?\s+\/(\s|$|\*)/,
  /\b(mkfs|fdisk|parted|wipefs|shred)\b/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot|poweroff|halt|init\s+[06])\b/i,
  /\biptables\s+(-F|--flush)\b/i,
  /\bchmod\s+-R\s+777\s+\//,
  /:\(\)\s*\{.*:\|:&\s*\};:/,
  />\s*\/dev\/(sd[a-z]|nvme|vd[a-z]|hd[a-z])/,
  /\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i,
  /\bDROP\s+(DATABASE|TABLE)\b/i,
  /\bfirstboot\b|\bsysupgrade\b/i,
];

const MEDIUM_RISK_PATTERNS: RegExp[] = [
  /\bsystemctl\s+(restart|stop|disable|mask|reload)\b/i,
  /\bservice\s+\S+\s+(restart|stop)\b/i,
  /\b(kill|killall|pkill)\b/i,
  /\brm\s+/i,
  /\b(mv|chmod|chown)\s+/i,
  /\bsed\s+-i\b/i,
  /\b(apt|apt-get|yum|dnf|pacman|apk|opkg|brew)\s+(install|remove|purge|upgrade|uninstall)\b/i,
  /\bdocker\s+(rm|rmi|stop|kill|restart|system\s+prune)\b/i,
  /\buci\s+(set|delete|commit)\b/i,
  /\bgit\s+(reset\s+--hard|push\s+(--force|-f)|clean\s+-fd)/i,
  /\bsudo\b/i,
];

const LOW_RISK_PATTERNS: RegExp[] = [
  /\b(mkdir|touch|cp|tee|ln)\s+/i,
  /\bgit\s+(add|commit|checkout|switch|pull|stash)\b/i,
  /\b(npm|pnpm|yarn|cargo|pip)\s+(install|run|build|test)\b/i,
  /[^2]>\s*\S+/,
];

const READONLY_HEAD_COMMANDS = new Set([
  'ls',
  'll',
  'la',
  'pwd',
  'whoami',
  'id',
  'uname',
  'hostname',
  'uptime',
  'date',
  'df',
  'du',
  'free',
  'top',
  'htop',
  'ps',
  'pgrep',
  'ss',
  'netstat',
  'ip',
  'ifconfig',
  'route',
  'arp',
  'ping',
  'traceroute',
  'dig',
  'nslookup',
  'host',
  'cat',
  'head',
  'tail',
  'less',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'awk',
  'sed',
  'cut',
  'sort',
  'uniq',
  'wc',
  'find',
  'which',
  'whereis',
  'type',
  'stat',
  'file',
  'env',
  'printenv',
  'echo',
  'journalctl',
  'dmesg',
  'logread',
  'iwinfo',
  'lsof',
  'lsblk',
  'lsusb',
  'lspci',
  'lscpu',
  'mount',
]);

/** Strip leading shell prompt prefixes (`$ `, `user@host:~$ `) and comments to get runnable lines. */
export function normalizeShellBlock(code: string): string {
  const promptRe = /^(?:(?:[\w.-]+@[\w.-]+(?::[^$#>\s]+)?)?[$#>]|PS\s+[^>]+>)\s+(.+)$/;
  const lines = code
    .split('\n')
    .map((raw) => raw.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const m = promptRe.exec(line);
      return (m?.[1] ?? line).trim();
    });
  return lines.join('\n').trim();
}

export function classifyCommandRisk(command: string): CommandRiskLevel {
  const normalized = normalizeShellBlock(command);
  if (!normalized) return 'safe';

  if (HIGH_RISK_PATTERNS.some((re) => re.test(normalized))) return 'high';
  if (MEDIUM_RISK_PATTERNS.some((re) => re.test(normalized))) return 'medium';
  if (LOW_RISK_PATTERNS.some((re) => re.test(normalized))) return 'low';

  const firstLine = normalized.split('\n')[0] ?? '';
  const firstToken = firstLine.split(/\s+/)[0]?.split('/').pop()?.toLowerCase() ?? '';
  if (READONLY_HEAD_COMMANDS.has(firstToken)) return 'safe';
  if (
    /^(?:systemctl\s+status|docker\s+(?:ps|logs|inspect|images|stats)|git\s+(?:status|log|diff|branch)|uci\s+show|opkg\s+list-installed)\b/i.test(
      firstLine,
    )
  ) {
    return 'safe';
  }
  return 'low';
}

function looksLikeShellCode(lang: string, code: string): boolean {
  const lower = lang.trim().toLowerCase();
  if (lower && !SHELL_LANGS.has(lower)) return false;
  if (lower && SHELL_LANGS.has(lower)) return true;
  // Unlabeled code block: treat as shell only if it doesn't look like JSON/XML/YAML/CSS.
  const trimmed = code.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('<')) return false;
  const runnable = normalizeShellBlock(trimmed);
  if (!runnable) return false;
  const firstLine = runnable.split('\n')[0] ?? '';
  return /^(?:sudo\s+)?[A-Za-z0-9_./-]+(?:\s|$)/.test(firstLine);
}

/** Parse Markdown into safe structured blocks for rendering in the AI panel. */
export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block (supports unclosed fences during live streaming).
    const fenceOpen = /^```([^\n`]*)$/.exec(trimmed);
    if (fenceOpen) {
      const lang = fenceOpen[1].trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1; // consume closing ```
      const code = codeLines.join('\n').replace(/\n+$/, '');
      const isShell = looksLikeShellCode(lang, code);
      const runnableCommand = isShell ? normalizeShellBlock(code) : '';
      blocks.push({
        type: 'code',
        lang,
        code,
        isShell: isShell && runnableCommand.length > 0,
        runnableCommand,
        risk: isShell && runnableCommand ? classifyCommandRisk(runnableCommand) : 'safe',
      });
      continue;
    }

    // Heading (# .. ####)
    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const len = heading[1].length;
      const level: 1 | 2 | 3 | 4 = len === 1 ? 1 : len === 2 ? 2 : len === 3 ? 3 : 4;
      blocks.push({ type: 'heading', level, text: heading[2].trim() });
      i += 1;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quoteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join('\n') });
      continue;
    }

    // Unordered list (- / * / •)
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^[-*•]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    // Ordered list (1. / 2.)
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^\d+[.)]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // Paragraph (consume until blank line or next block opener)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const curr = lines[i] ?? '';
      const currTrim = curr.trim();
      if (
        !currTrim ||
        currTrim.startsWith('```') ||
        /^#{1,4}\s+/.test(currTrim) ||
        currTrim.startsWith('>') ||
        /^[-*•]\s+/.test(currTrim) ||
        /^\d+[.)]\s+/.test(currTrim)
      ) {
        break;
      }
      paraLines.push(curr);
      i += 1;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
    }
  }

  return blocks;
}

/** Tokenize inline markdown (`code`, **bold**, *italic*) safely without HTML injection. */
export function tokenizeInlineMarkdown(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const regex = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      tokens.push({ type: 'text', value: text.slice(lastIdx, match.index) });
    }
    if (match[1] !== undefined) {
      tokens.push({ type: 'code', value: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({ type: 'bold', value: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ type: 'italic', value: match[3] });
    }
    lastIdx = regex.lastIndex;
  }

  if (lastIdx < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIdx) });
  }
  return tokens;
}
