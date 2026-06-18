import {
  File,
  FileCode,
  FileJson,
  FileText,
  FileImage,
  FileArchive,
  FileVideo,
  FileAudio,
  FileSpreadsheet,
  FileKey,
  FileCog,
  FileTerminal,
  type LucideIcon,
} from 'lucide-react';

export interface FileIconSpec {
  Icon: LucideIcon;
  /** CSS class carrying the icon's tint (see .sftp-icon-* in global.css). */
  cls: string;
}

// Extension → icon + colour class. Lower-cased extension (no dot) is the key.
const EXT_MAP: Record<string, FileIconSpec> = {};
function reg(exts: string[], Icon: LucideIcon, cls: string) {
  for (const e of exts) EXT_MAP[e] = { Icon, cls };
}

reg(
  ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'c', 'cc',
    'cpp', 'cxx', 'h', 'hpp', 'rb', 'php', 'swift', 'kt', 'kts', 'scala', 'lua',
    'dart', 'vue', 'svelte', 'sql', 'r', 'pl'],
  FileCode, 'sftp-icon-code',
);
reg(['html', 'htm', 'css', 'scss', 'sass', 'less'], FileCode, 'sftp-icon-web');
reg(
  ['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'cfg', 'env',
    'properties', 'lock'],
  FileJson, 'sftp-icon-data',
);
reg(['md', 'markdown', 'txt', 'rst', 'log', 'rtf', 'nfo'], FileText, 'sftp-icon-doc');
reg(
  ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'tif', 'heic', 'avif'],
  FileImage, 'sftp-icon-image',
);
reg(
  ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'zst', 'lz', 'lzma', 'jar', 'war'],
  FileArchive, 'sftp-icon-archive',
);
reg(['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg'], FileVideo, 'sftp-icon-media');
reg(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma'], FileAudio, 'sftp-icon-audio');
reg(['csv', 'tsv', 'xls', 'xlsx', 'ods'], FileSpreadsheet, 'sftp-icon-sheet');
reg(['pdf'], FileText, 'sftp-icon-pdf');
reg(['doc', 'docx', 'odt'], FileText, 'sftp-icon-word');
reg(['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'], FileTerminal, 'sftp-icon-shell');
reg(['pem', 'key', 'crt', 'cer', 'pub', 'asc', 'gpg', 'p12', 'pfx', 'kdbx'], FileKey, 'sftp-icon-key');
reg(['so', 'o', 'a', 'dll', 'exe', 'bin', 'dylib', 'class', 'pyc', 'wasm', 'deb', 'rpm'], FileCog, 'sftp-icon-binary');

// Whole-name matches (no extension, or a conventional name). Lower-cased.
const NAME_MAP: Record<string, FileIconSpec> = {
  dockerfile: { Icon: FileCode, cls: 'sftp-icon-code' },
  makefile: { Icon: FileTerminal, cls: 'sftp-icon-shell' },
  'cmakelists.txt': { Icon: FileCode, cls: 'sftp-icon-code' },
  license: { Icon: FileText, cls: 'sftp-icon-doc' },
  readme: { Icon: FileText, cls: 'sftp-icon-doc' },
};

const DEFAULT: FileIconSpec = { Icon: File, cls: 'sftp-icon-file' };

/** Pick a type-appropriate icon + colour for a file (not a directory) by name. */
export function fileIconFor(name: string): FileIconSpec {
  const lower = name.toLowerCase();

  const named = NAME_MAP[lower];
  if (named) return named;

  const dot = lower.lastIndexOf('.');
  // dot > 0 skips dotfiles like ".bashrc" (lastIndexOf would be 0); treat those
  // as config rather than generic files.
  if (dot > 0) {
    const spec = EXT_MAP[lower.slice(dot + 1)];
    if (spec) return spec;
  } else if (lower.startsWith('.')) {
    return { Icon: FileCog, cls: 'sftp-icon-data' };
  }

  return DEFAULT;
}
