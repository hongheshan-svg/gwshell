// src/components/Terminal/types.ts
// Shared types for TerminalView and its overlay components.

export interface FingerprintInfo {
  fingerprint: string;
  keyType: string;
  host: string;
  port: number;
  /** Set when the host was pinned under a different key type (possible MITM). */
  knownKeyType?: string | null;
}

export interface TerminalContextMenuState {
  x: number;
  y: number;
  canCopy: boolean;
}
