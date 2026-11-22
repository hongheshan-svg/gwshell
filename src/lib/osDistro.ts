export type OsDistroKind =
  | 'ubuntu'
  | 'debian'
  | 'rocky'
  | 'centos'
  | 'redhat'
  | 'alpine'
  | 'arch'
  | 'fedora'
  | 'suse'
  | 'macos'
  | 'windows'
  | 'linux';

/** Detect OS / Linux distribution from an `/etc/os-release` pretty string. */
export function detectOsDistro(osPretty?: string | null): OsDistroKind {
  const s = (osPretty ?? '').toLowerCase();
  if (s.includes('ubuntu')) return 'ubuntu';
  if (s.includes('debian') || s.includes('raspbian') || s.includes('kali')) return 'debian';
  if (s.includes('rocky')) return 'rocky';
  if (s.includes('centos') || s.includes('alma')) return 'centos';
  if (s.includes('red hat') || s.includes('rhel') || s.includes('oracle linux')) return 'redhat';
  if (s.includes('alpine')) return 'alpine';
  if (s.includes('arch') || s.includes('manjaro')) return 'arch';
  if (s.includes('fedora')) return 'fedora';
  if (s.includes('suse')) return 'suse';
  if (s.includes('mac') || s.includes('darwin')) return 'macos';
  if (s.includes('win')) return 'windows';
  return 'linux';
}

/** Shorten an `os_pretty` string for compact host cards (e.g. "Ubuntu 22.04"). */
export function shortOsLabel(osPretty?: string | null): string {
  if (!osPretty) return '';
  const cleaned = osPretty
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\bGNU\/Linux\b/i, '')
    .replace(/\bLTS\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = cleaned.split(' ');
  return parts.slice(0, 2).join(' ');
}
