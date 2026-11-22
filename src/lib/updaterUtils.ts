export const DISMISSED_UPDATE_KEY = 'gwshell.updateDismissedVersion';

/** Clamp download percentage into [0, 100], returning null when total size is unknown. */
export function computeDownloadProgress(
  downloadedBytes: number,
  totalBytes: number,
): number | null {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  if (!Number.isFinite(downloadedBytes) || downloadedBytes <= 0) return 0;
  return Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
}

/** Human-readable byte count for OTA progress displays (e.g. "12.4 MB"). */
export function formatUpdateBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/** Format an ISO/RFC3339 release date string into YYYY-MM-DD when valid. */
export function formatReleaseDate(raw?: string | null): string {
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

/** Normalize unknown thrown updater errors into a compact displayable message. */
export function normalizeUpdateError(err: unknown): string {
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message; // eslint-disable-line no-restricted-syntax -- narrowing unknown error object
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  }
  return 'Unknown updater error';
}

export function getDismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_UPDATE_KEY);
  } catch {
    return null;
  }
}

export function setDismissedVersion(version: string): void {
  try {
    localStorage.setItem(DISMISSED_UPDATE_KEY, version);
  } catch {
    /* ignore storage quota / privacy errors */
  }
}

export function clearDismissedVersion(): void {
  try {
    localStorage.removeItem(DISMISSED_UPDATE_KEY);
  } catch {
    /* ignore */
  }
}
