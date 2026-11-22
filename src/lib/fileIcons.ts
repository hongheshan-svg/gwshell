export type FolderBadgeKind =
  'none' | 'parent' | 'ssh' | 'git' | 'config' | 'code' | 'package' | 'docker' | 'log' | 'home';

export interface FolderVisual {
  badge: FolderBadgeKind;
  /** Back tab & darker rim shade */
  back: string;
  /** Main front flap color */
  front: string;
  /** Soft inner highlight on front top edge */
  highlight: string;
  /** Emblem stroke/fill color */
  emblem: string;
  /** Slightly muted opacity for hidden dot-directories */
  dimmed?: boolean;
}

export type FileGlyphKind =
  | 'badge'
  | 'shell'
  | 'json'
  | 'image'
  | 'archive'
  | 'key'
  | 'docker'
  | 'video'
  | 'audio'
  | 'sheet'
  | 'binary'
  | 'text'
  | 'generic';

export interface FileVisual {
  glyph: FileGlyphKind;
  /** Primary brand/type color */
  accent: string;
  /** Badge text when glyph === 'badge' (2-4 uppercase chars) */
  badge?: string;
  /** Badge text foreground color (defaults to #ffffff) */
  badgeFg?: string;
  /** Slightly muted for dotfiles */
  dimmed?: boolean;
}

// Semantic folder classification (exact lowercase folder name → visual)
const FOLDER_PRESETS: Record<string, FolderVisual> = {
  // Security & SSH
  '.ssh': {
    badge: 'ssh',
    back: '#047857',
    front: '#10b981',
    highlight: '#6ee7b7',
    emblem: '#022c22',
  },
  ssl: {
    badge: 'ssh',
    back: '#047857',
    front: '#10b981',
    highlight: '#6ee7b7',
    emblem: '#022c22',
  },
  certs: {
    badge: 'ssh',
    back: '#047857',
    front: '#10b981',
    highlight: '#6ee7b7',
    emblem: '#022c22',
  },
  keys: {
    badge: 'ssh',
    back: '#b45309',
    front: '#f59e0b',
    highlight: '#fde68a',
    emblem: '#451a03',
  },
  // Git
  '.git': {
    badge: 'git',
    back: '#c2410c',
    front: '#f97316',
    highlight: '#fdba74',
    emblem: '#431407',
  },
  '.github': {
    badge: 'git',
    back: '#475569',
    front: '#64748b',
    highlight: '#cbd5e1',
    emblem: '#0f172a',
  },
  // Config / System
  etc: {
    badge: 'config',
    back: '#0369a1',
    front: '#0ea5e9',
    highlight: '#7dd3fc',
    emblem: '#082f49',
  },
  config: {
    badge: 'config',
    back: '#0369a1',
    front: '#0ea5e9',
    highlight: '#7dd3fc',
    emblem: '#082f49',
  },
  '.config': {
    badge: 'config',
    back: '#0369a1',
    front: '#0ea5e9',
    highlight: '#7dd3fc',
    emblem: '#082f49',
    dimmed: true,
  },
  conf: {
    badge: 'config',
    back: '#0369a1',
    front: '#0ea5e9',
    highlight: '#7dd3fc',
    emblem: '#082f49',
  },
  nginx: {
    badge: 'config',
    back: '#047857',
    front: '#10b981',
    highlight: '#6ee7b7',
    emblem: '#022c22',
  },
  systemd: {
    badge: 'config',
    back: '#0369a1',
    front: '#0ea5e9',
    highlight: '#7dd3fc',
    emblem: '#082f49',
  },
  // Code / Source / Binaries
  src: {
    badge: 'code',
    back: '#2563eb',
    front: '#3b82f6',
    highlight: '#93c5fd',
    emblem: '#eff6ff',
  },
  app: {
    badge: 'code',
    back: '#2563eb',
    front: '#3b82f6',
    highlight: '#93c5fd',
    emblem: '#eff6ff',
  },
  lib: {
    badge: 'code',
    back: '#4f46e5',
    front: '#6366f1',
    highlight: '#a5b4fc',
    emblem: '#eef2ff',
  },
  pkg: {
    badge: 'code',
    back: '#4f46e5',
    front: '#6366f1',
    highlight: '#a5b4fc',
    emblem: '#eef2ff',
  },
  bin: {
    badge: 'code',
    back: '#0f766e',
    front: '#14b8a6',
    highlight: '#99f6e4',
    emblem: '#042f2e',
  },
  sbin: {
    badge: 'code',
    back: '#0f766e',
    front: '#14b8a6',
    highlight: '#99f6e4',
    emblem: '#042f2e',
  },
  scripts: {
    badge: 'code',
    back: '#0f766e',
    front: '#14b8a6',
    highlight: '#99f6e4',
    emblem: '#042f2e',
  },
  // Containers & Orchestration
  docker: {
    badge: 'docker',
    back: '#0284c7',
    front: '#38bdf8',
    highlight: '#bae6fd',
    emblem: '#082f49',
  },
  k8s: {
    badge: 'docker',
    back: '#1d4ed8',
    front: '#3b82f6',
    highlight: '#93c5fd',
    emblem: '#eff6ff',
  },
  '.kube': {
    badge: 'docker',
    back: '#1d4ed8',
    front: '#3b82f6',
    highlight: '#93c5fd',
    emblem: '#eff6ff',
    dimmed: true,
  },
  // Dependencies / Build output
  node_modules: {
    badge: 'package',
    back: '#475569',
    front: '#64748b',
    highlight: '#cbd5e1',
    emblem: '#f1f5f9',
  },
  vendor: {
    badge: 'package',
    back: '#475569',
    front: '#64748b',
    highlight: '#cbd5e1',
    emblem: '#f1f5f9',
  },
  dist: {
    badge: 'package',
    back: '#6d28d9',
    front: '#8b5cf6',
    highlight: '#c4b5fd',
    emblem: '#f5f3ff',
  },
  build: {
    badge: 'package',
    back: '#6d28d9',
    front: '#8b5cf6',
    highlight: '#c4b5fd',
    emblem: '#f5f3ff',
  },
  target: {
    badge: 'package',
    back: '#6d28d9',
    front: '#8b5cf6',
    highlight: '#c4b5fd',
    emblem: '#f5f3ff',
  },
  // Logs & Var
  log: {
    badge: 'log',
    back: '#7c3aed',
    front: '#a78bfa',
    highlight: '#ddd6fe',
    emblem: '#2e1065',
  },
  logs: {
    badge: 'log',
    back: '#7c3aed',
    front: '#a78bfa',
    highlight: '#ddd6fe',
    emblem: '#2e1065',
  },
  var: {
    badge: 'log',
    back: '#0f766e',
    front: '#2dd4bf',
    highlight: '#99f6e4',
    emblem: '#042f2e',
  },
  // Home & User
  home: {
    badge: 'home',
    back: '#059669',
    front: '#34d399',
    highlight: '#a7f3d0',
    emblem: '#022c22',
  },
  root: {
    badge: 'home',
    back: '#059669',
    front: '#34d399',
    highlight: '#a7f3d0',
    emblem: '#022c22',
  },
  users: {
    badge: 'home',
    back: '#059669',
    front: '#34d399',
    highlight: '#a7f3d0',
    emblem: '#022c22',
  },
};

const DEFAULT_FOLDER: FolderVisual = {
  badge: 'none',
  back: '#d97706',
  front: '#fbbf24',
  highlight: '#fde68a',
  emblem: '#78350f',
};

const HIDDEN_FOLDER: FolderVisual = {
  badge: 'none',
  back: '#92400e',
  front: '#d97706',
  highlight: '#fcd34d',
  emblem: '#451a03',
  dimmed: true,
};

export const PARENT_FOLDER_VISUAL: FolderVisual = {
  badge: 'parent',
  back: '#475569',
  front: '#64748b',
  highlight: '#cbd5e1',
  emblem: '#f8fafc',
};

/** Resolve rich layered folder visuals by directory name. */
export function resolveFolderVisual(name: string): FolderVisual {
  const lower = name.toLowerCase();
  const preset = FOLDER_PRESETS[lower];
  if (preset) return preset;
  if (lower.startsWith('.')) return HIDDEN_FOLDER;
  return DEFAULT_FOLDER;
}

// Extension → rich file visual (lowercase, no leading dot)
const FILE_EXT_MAP: Record<string, FileVisual> = {};
function regExt(exts: string[], visual: FileVisual) {
  for (const e of exts) FILE_EXT_MAP[e] = visual;
}

// TypeScript / JavaScript
regExt(['ts', 'mts', 'cts'], { glyph: 'badge', accent: '#3178c6', badge: 'TS' });
regExt(['tsx'], { glyph: 'badge', accent: '#38bdf8', badge: 'TSX', badgeFg: '#082f49' });
regExt(['js', 'mjs', 'cjs'], {
  glyph: 'badge',
  accent: '#eab308',
  badge: 'JS',
  badgeFg: '#1c1917',
});
regExt(['jsx'], { glyph: 'badge', accent: '#f59e0b', badge: 'JSX', badgeFg: '#1c1917' });

// Systems & Backend Languages
regExt(['py', 'pyw', 'pyi'], { glyph: 'badge', accent: '#3b82f6', badge: 'PY' });
regExt(['rs'], { glyph: 'badge', accent: '#ea580c', badge: 'RS' });
regExt(['go'], { glyph: 'badge', accent: '#06b6d4', badge: 'GO', badgeFg: '#083344' });
regExt(['java', 'kt', 'kts'], { glyph: 'badge', accent: '#ef4444', badge: 'JVM' });
regExt(['c', 'h'], { glyph: 'badge', accent: '#60a5fa', badge: 'C', badgeFg: '#0f172a' });
regExt(['cc', 'cpp', 'cxx', 'hpp'], { glyph: 'badge', accent: '#3b82f6', badge: 'C++' });
regExt(['php'], { glyph: 'badge', accent: '#8b5cf6', badge: 'PHP' });
regExt(['rb'], { glyph: 'badge', accent: '#e11d48', badge: 'RB' });
regExt(['swift'], { glyph: 'badge', accent: '#f97316', badge: 'SW' });
regExt(['lua'], { glyph: 'badge', accent: '#6366f1', badge: 'LUA' });
regExt(['dart'], { glyph: 'badge', accent: '#0ea5e9', badge: 'DRT' });
regExt(['scala', 'r', 'pl'], { glyph: 'badge', accent: '#ec4899', badge: 'SRC' });

// Web & Markup
regExt(['html', 'htm'], { glyph: 'badge', accent: '#f97316', badge: 'HTM' });
regExt(['css'], { glyph: 'badge', accent: '#0ea5e9', badge: 'CSS' });
regExt(['scss', 'sass', 'less'], { glyph: 'badge', accent: '#ec4899', badge: 'CSS' });
regExt(['vue'], { glyph: 'badge', accent: '#10b981', badge: 'VUE', badgeFg: '#022c22' });
regExt(['svelte'], { glyph: 'badge', accent: '#f97316', badge: 'SVL' });
regExt(['sql', 'sqlite', 'db'], { glyph: 'badge', accent: '#0284c7', badge: 'SQL' });

// Config & Structured Data
regExt(['json', 'jsonc', 'json5'], { glyph: 'json', accent: '#f59e0b' });
regExt(['yml', 'yaml'], { glyph: 'badge', accent: '#e11d48', badge: 'YML' });
regExt(['toml'], { glyph: 'badge', accent: '#94a3b8', badge: 'TML', badgeFg: '#0f172a' });
regExt(['xml', 'plist'], { glyph: 'badge', accent: '#f97316', badge: 'XML' });
regExt(['ini', 'conf', 'cfg', 'properties', 'service', 'socket', 'timer'], {
  glyph: 'badge',
  accent: '#14b8a6',
  badge: 'CFG',
  badgeFg: '#042f2e',
});
regExt(['env'], { glyph: 'badge', accent: '#eab308', badge: 'ENV', badgeFg: '#1c1917' });
regExt(['lock'], { glyph: 'key', accent: '#94a3b8' });

// Shell & Scripts
regExt(['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'awk'], {
  glyph: 'shell',
  accent: '#10b981',
});

// Docs, Logs & Office
regExt(['md', 'markdown', 'mdx'], {
  glyph: 'badge',
  accent: '#38bdf8',
  badge: 'MD',
  badgeFg: '#082f49',
});
regExt(['log'], { glyph: 'badge', accent: '#f59e0b', badge: 'LOG', badgeFg: '#1c1917' });
regExt(['txt', 'rst', 'rtf', 'nfo'], { glyph: 'text', accent: '#94a3b8' });
regExt(['pdf'], { glyph: 'badge', accent: '#ef4444', badge: 'PDF' });
regExt(['doc', 'docx', 'odt'], { glyph: 'badge', accent: '#2563eb', badge: 'DOC' });
regExt(['csv', 'tsv', 'xls', 'xlsx', 'ods'], { glyph: 'sheet', accent: '#10b981' });

// Media & Images
regExt(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'tif', 'heic', 'avif'], {
  glyph: 'image',
  accent: '#a855f7',
});
regExt(['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg'], {
  glyph: 'video',
  accent: '#ec4899',
});
regExt(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma'], {
  glyph: 'audio',
  accent: '#06b6d4',
});

// Archives & Packages
regExt(
  [
    'zip',
    'tar',
    'gz',
    'tgz',
    'bz2',
    'xz',
    '7z',
    'rar',
    'zst',
    'lz',
    'lzma',
    'jar',
    'war',
    'deb',
    'rpm',
    'apk',
    'dmg',
  ],
  { glyph: 'archive', accent: '#f59e0b' },
);

// Keys & Certs
regExt(['pem', 'key', 'crt', 'cer', 'pub', 'asc', 'gpg', 'p12', 'pfx', 'kdbx'], {
  glyph: 'key',
  accent: '#eab308',
});

// Binaries
regExt(['so', 'o', 'a', 'dll', 'exe', 'bin', 'dylib', 'class', 'pyc', 'wasm', 'elf'], {
  glyph: 'binary',
  accent: '#64748b',
});

// Whole-name matches (lowercase)
const FILE_NAME_MAP: Record<string, FileVisual> = {
  dockerfile: { glyph: 'docker', accent: '#38bdf8' },
  'docker-compose.yml': { glyph: 'docker', accent: '#38bdf8' },
  'docker-compose.yaml': { glyph: 'docker', accent: '#38bdf8' },
  'compose.yml': { glyph: 'docker', accent: '#38bdf8' },
  'compose.yaml': { glyph: 'docker', accent: '#38bdf8' },
  '.dockerignore': { glyph: 'docker', accent: '#38bdf8', dimmed: true },
  makefile: { glyph: 'shell', accent: '#10b981' },
  'cmakelists.txt': { glyph: 'badge', accent: '#3b82f6', badge: 'CMK' },
  'package.json': { glyph: 'json', accent: '#10b981' },
  'cargo.toml': { glyph: 'badge', accent: '#ea580c', badge: 'RS' },
  'go.mod': { glyph: 'badge', accent: '#06b6d4', badge: 'GO', badgeFg: '#083344' },
  'go.sum': { glyph: 'badge', accent: '#06b6d4', badge: 'GO', badgeFg: '#083344' },
  'nginx.conf': { glyph: 'badge', accent: '#10b981', badge: 'NGX', badgeFg: '#022c22' },
  authorized_keys: { glyph: 'key', accent: '#10b981' },
  known_hosts: { glyph: 'key', accent: '#10b981' },
  id_rsa: { glyph: 'key', accent: '#eab308' },
  id_ed25519: { glyph: 'key', accent: '#eab308' },
  license: { glyph: 'text', accent: '#f59e0b' },
  readme: { glyph: 'badge', accent: '#38bdf8', badge: 'MD', badgeFg: '#082f49' },
  '.gitignore': { glyph: 'badge', accent: '#f97316', badge: 'GIT', dimmed: true },
  '.env': { glyph: 'badge', accent: '#eab308', badge: 'ENV', badgeFg: '#1c1917', dimmed: true },
};

const DEFAULT_FILE: FileVisual = { glyph: 'generic', accent: '#94a3b8' };

/** Resolve rich layered file visuals by filename. */
export function resolveFileVisual(name: string): FileVisual {
  const lower = name.toLowerCase();
  const named = FILE_NAME_MAP[lower];
  if (named) return named;

  if (lower.startsWith('.env.')) {
    return { glyph: 'badge', accent: '#eab308', badge: 'ENV', badgeFg: '#1c1917', dimmed: true };
  }
  if (lower.startsWith('dockerfile.')) {
    return { glyph: 'docker', accent: '#38bdf8' };
  }

  const dot = lower.lastIndexOf('.');
  if (dot > 0) {
    const ext = lower.slice(dot + 1);
    const spec = FILE_EXT_MAP[ext];
    if (spec) return lower.startsWith('.') ? { ...spec, dimmed: true } : spec;
  } else if (lower.startsWith('.')) {
    return { glyph: 'badge', accent: '#14b8a6', badge: 'CFG', badgeFg: '#042f2e', dimmed: true };
  }

  return DEFAULT_FILE;
}
