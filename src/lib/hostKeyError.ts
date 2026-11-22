// Parses the `FINGERPRINT_*:{json}` host-key rejection strings emitted by the
// Rust SSH backend (`HostKeyError::to_error_string` in src-tauri/src/ssh/handler.rs).

export type HostKeyErrorKind = 'unknown' | 'mismatch' | 'keytype_changed';

export interface HostKeyError {
  kind: HostKeyErrorKind;
  fingerprint: string;
  keyType: string;
  /** Previously pinned key type (only for `keytype_changed`). */
  knownKeyType: string | null;
  /** The host/port the key belongs to — the jump host's when that hop failed. */
  host: string | null;
  port: number | null;
}

const PREFIXES: readonly [string, HostKeyErrorKind][] = [
  ['FINGERPRINT_UNKNOWN:', 'unknown'],
  ['FINGERPRINT_MISMATCH:', 'mismatch'],
  ['FINGERPRINT_KEYTYPE_CHANGED:', 'keytype_changed'],
];

/**
 * Parse a backend connect error. Returns null for any other error. The error
 * may arrive wrapped (e.g. "SSH connect failed: FINGERPRINT_…"), so the
 * prefix is located anywhere in the string.
 */
export function parseHostKeyError(raw: string): HostKeyError | null {
  for (const [prefix, kind] of PREFIXES) {
    const at = raw.indexOf(prefix);
    if (at === -1) continue;
    try {
      const payload: unknown = JSON.parse(raw.slice(at + prefix.length));
      if (!payload || typeof payload !== 'object') return null;
      const o = payload as Record<string, unknown>; // eslint-disable-line no-restricted-syntax -- narrowed unknown JSON object
      if (typeof o.fingerprint !== 'string' || typeof o.keyType !== 'string') return null;
      return {
        kind,
        fingerprint: o.fingerprint,
        keyType: o.keyType,
        knownKeyType: typeof o.knownKeyType === 'string' ? o.knownKeyType : null,
        host: typeof o.host === 'string' ? o.host : null,
        port: typeof o.port === 'number' ? o.port : null,
      };
    } catch {
      return null;
    }
  }
  return null;
}
