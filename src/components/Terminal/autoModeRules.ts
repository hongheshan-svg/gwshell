import type { AutoModeRule, AutoModeCustomRule, AutoModeDetectionContext } from '../../types';

/**
 * Built-in rules. Priority ordering:
 *   > 200  reserved for user custom rules
 *   100    CLI-specific (Claude Code 3-option)
 *    90    CLI-specific (Claude Code 2-option)
 *    50    Generic y/N fallback
 * First non-null match wins; rules are tried highest priority first.
 */

const BUILTIN_RULES: AutoModeRule[] = [
  {
    id: 'builtin.claude-code.3-option',
    name: 'Claude Code 3-option',
    priority: 100,
    match: (ctx) => {
      const txt = ctx.visibleLines.join('\n');
      const hasOption1Yes = /(?:^|\n)\s*(?:❯\s*)?1\.\s*Yes\b/m.test(txt);
      const hasDontAskAgain = /(?:^|\n)\s*(?:❯\s*)?2\.\s*Yes,?\s*and\s*don'?t\s*ask\s*again/im.test(txt);
      const hasOption3No = /(?:^|\n)\s*(?:❯\s*)?3\.\s*No/m.test(txt);
      if (hasOption1Yes && hasDontAskAgain && hasOption3No) {
        return {
          response: '2\r',
          label: "Yes, and don't ask again",
          ruleName: 'Claude Code 3-option',
        };
      }
      return null;
    },
  },
  {
    id: 'builtin.claude-code.2-option',
    name: 'Claude Code 2-option',
    priority: 90,
    match: (ctx) => {
      const txt = ctx.visibleLines.join('\n');
      const hasOption1Yes = /(?:^|\n)\s*(?:❯\s*)?1\.\s*Yes\b/m.test(txt);
      const hasOption2No = /(?:^|\n)\s*(?:❯\s*)?2\.\s*No\b/m.test(txt);
      const hasDontAskAgain = /don'?t\s*ask\s*again/i.test(txt);
      if (hasOption1Yes && hasOption2No && !hasDontAskAgain) {
        return {
          response: '1\r',
          label: 'Yes',
          ruleName: 'Claude Code 2-option',
        };
      }
      return null;
    },
  },
  {
    id: 'builtin.generic.y-n',
    name: 'Generic y/N',
    priority: 50,
    match: (ctx) => {
      // Inspect the last 3 non-empty visible lines, right-trimmed.
      const nonEmpty = ctx.visibleLines.map((l) => l.trimEnd()).filter((l) => l.length > 0);
      const tail = nonEmpty.slice(-3).join(' ');
      if (!tail) return null;
      // Match (y/n), [y/N], (Y/n), [YES/NO] at/near the end of the visible buffer.
      const patterns = [
        /\[[yY]\/[nN]\]\s*$/,
        /\([yY]\/[nN]\)\s*$/,
        /\[[yY][eE][sS]\/[nN][oO]\]\s*$/i,
        /\([yY][eE][sS]\/[nN][oO]\)\s*$/i,
        /\?\s*\[[yY]\/[nN]\]\s*:?\s*$/,
      ];
      if (patterns.some((p) => p.test(tail))) {
        return {
          response: 'y\r',
          label: 'y',
          ruleName: 'Generic y/N',
        };
      }
      return null;
    },
  },
];

/**
 * Decode escape sequences in custom-rule response strings. Users type literal
 * "y\r" in the settings UI; we decode \r \n \t and \xHH at load time.
 */
function decodeEscapes(s: string): string {
  return s.replace(/\\(r|n|t|\\|x[0-9a-fA-F]{2})/g, (_m, g) => {
    if (g === 'r') return '\r';
    if (g === 'n') return '\n';
    if (g === 't') return '\t';
    if (g === '\\') return '\\';
    if (g.startsWith('x')) return String.fromCharCode(parseInt(g.slice(1), 16));
    return _m;
  });
}

/**
 * Convert a saved custom rule into an AutoModeRule. Returns null and logs a warning
 * if the regex is invalid — the watcher will skip it.
 */
export function compileCustomRule(rule: AutoModeCustomRule): AutoModeRule | null {
  if (!rule.enabled) return null;
  let regex: RegExp;
  try {
    regex = new RegExp(rule.pattern, rule.flags);
  } catch (err) {
    console.warn(`[AutoMode] custom rule ${rule.id} has invalid regex:`, err);
    return null;
  }
  const decoded = decodeEscapes(rule.response);
  return {
    id: `custom.${rule.id}`,
    name: rule.label || 'custom',
    priority: rule.priority,
    match: (ctx: AutoModeDetectionContext) => {
      const txt = ctx.visibleLines.join('\n');
      if (regex.test(txt)) {
        return { response: decoded, label: rule.label || 'custom', ruleName: `custom:${rule.label || rule.id}` };
      }
      return null;
    },
  };
}

/**
 * Combine built-in rules + compiled custom rules, sorted by descending priority.
 */
export function getAllRules(customRules: AutoModeCustomRule[]): AutoModeRule[] {
  const customCompiled = customRules.map(compileCustomRule).filter((r): r is AutoModeRule => r !== null);
  return [...BUILTIN_RULES, ...customCompiled].sort((a, b) => b.priority - a.priority);
}

export const BUILTIN_RULE_IDS = BUILTIN_RULES.map((r) => r.id);
