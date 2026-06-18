export interface QuickTarget {
  username?: string;
  host: string;
  port: number;
}

// Parses `[user@]host[:port]` into a target. Returns null when there is no host.
// A trailing `:NNN` is treated as a port only when NNN is a valid 1-65535 number;
// otherwise the colon is kept as part of the host (e.g. a bare IPv6 address).
export function parseQuickConnect(input: string): QuickTarget | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let rest = trimmed;
  let username: string | undefined;
  const at = rest.lastIndexOf('@');
  if (at >= 0) {
    username = rest.slice(0, at) || undefined;
    rest = rest.slice(at + 1);
  }

  let host = rest;
  let port = 22;

  // IPv6 literal in bracketed form: [::1] or [::1]:22. Strip the brackets
  // (SSH connects to the bare address) and parse an optional trailing port.
  // Without this, lastIndexOf(':') would grab a colon inside the address.
  if (rest.startsWith('[')) {
    const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(rest);
    if (m) {
      host = m[1];
      if (m[2] !== undefined) port = Number(m[2]);
    }
  } else {
    const colon = rest.lastIndexOf(':');
    if (colon >= 0) {
      const portStr = rest.slice(colon + 1);
      const p = Number(portStr);
      if (/^\d+$/.test(portStr) && p >= 1 && p <= 65535) {
        host = rest.slice(0, colon);
        port = p;
      }
    }
  }

  host = host.trim();
  if (!host) return null;
  return { username, host, port };
}
