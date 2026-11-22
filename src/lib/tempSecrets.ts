// Ephemeral in-memory storage for temporary session credentials (e.g. Quick
// Connect passwords) so plaintext secrets never enter React/Zustand store state.

const tempPasswords = new Map<string, string>();

export function setTempPassword(sessionId: string, password: string): void {
  if (password) {
    tempPasswords.set(sessionId, password);
  } else {
    tempPasswords.delete(sessionId);
  }
}

export function getTempPassword(sessionId: string): string | undefined {
  return tempPasswords.get(sessionId);
}

export function clearTempPassword(sessionId: string): void {
  tempPasswords.delete(sessionId);
}
