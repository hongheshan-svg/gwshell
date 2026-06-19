export function hasLiteralTildeSegment(path: string): boolean {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => segment === '~');
}

export function normalizeResolvedSftpDirectory(path: string): string | null {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  if (!normalized || hasLiteralTildeSegment(normalized)) return null;
  return normalized;
}

export function getSftpHomeCandidates(username?: string): string[] {
  const user = username?.trim();
  const candidates =
    user && !user.includes('/') && !user.includes('\\')
      ? user === 'root'
        ? ['/root', '.', '/']
        : [`/home/${user}`, `/Users/${user}`, '.', '/']
      : ['.', '/'];

  return candidates.filter((candidate, index) => (
    candidate && !hasLiteralTildeSegment(candidate) && candidates.indexOf(candidate) === index
  ));
}
