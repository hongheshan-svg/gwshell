export interface SftpEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number | null;
  permissions: number | null;
}

/** Payload of the backend's `sftp-progress-{sessionId}` events. */
export interface SftpProgress {
  kind: 'upload' | 'download';
  file: string;
  fileIndex: number;
  fileTotal: number;
  bytes: number;
  total: number;
}

export const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'json',
  'xml',
  'yml',
  'yaml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'sh',
  'bash',
  'zsh',
  'fish',
  'bat',
  'cmd',
  'ps1',
  'js',
  'ts',
  'jsx',
  'tsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'pl',
  'php',
  'lua',
  'go',
  'rs',
  'java',
  'kt',
  'scala',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'css',
  'scss',
  'less',
  'sass',
  'html',
  'htm',
  'vue',
  'svelte',
  'sql',
  'graphql',
  'gql',
  'env',
  'gitignore',
  'dockerignore',
  'editorconfig',
  'eslintrc',
  'prettierrc',
  'log',
  'csv',
  'tsv',
  'properties',
  'service',
  'timer',
  'socket',
  'desktop',
  'nginx',
  'apache',
  'makefile',
  'dockerfile',
  'vagrantfile',
  'rakefile',
  'gemfile',
  'readme',
  'license',
  'hosts',
  'fstab',
  'crontab',
  'passwd',
  'group',
  'sudoers',
]);

export function isTextFile(name: string): boolean {
  if (name.startsWith('.') && !name.includes('.', 1)) return true;
  const lower = name.toLowerCase();
  if (TEXT_EXTENSIONS.has(lower)) return true;
  const ext = lower.includes('.') ? (lower.split('.').pop() ?? '') : '';
  return ext !== '' && TEXT_EXTENSIONS.has(ext);
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

export function formatPermissions(perm: number | null): string {
  if (perm === null) return '';
  const mode = perm & 0o7777;
  return mode > 0o777 ? mode.toString(8).padStart(4, '0') : mode.toString(8).padStart(3, '0');
}
