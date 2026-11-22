// Shared formatting & health-level helpers for the Server Panel telemetry UI.

export type UsageLevel = 'ok' | 'warn' | 'danger';

export function usageLevel(pct: number): UsageLevel {
  if (pct >= 85) return 'danger';
  if (pct >= 65) return 'warn';
  return 'ok';
}

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`;
}

export function fmtRate(bps: number): string {
  return `${fmtBytes(bps)}/s`;
}

export function fmtKb(kb: number): string {
  if (kb < 1024) return `${kb} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function fmtUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

export function platformDisplayLabel(platform?: string): string {
  switch ((platform ?? '').toLowerCase()) {
    case 'linux':
      return 'Linux';
    case 'macos':
      return 'macOS';
    case 'bsd':
      return 'BSD';
    case 'windows':
      return 'Windows';
    default:
      return '';
  }
}
