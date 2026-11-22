import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getSftpHomeCandidates, normalizeResolvedSftpDirectory } from '../lib/sftpPaths';
import type { SftpEntry } from '../lib/sftpUtils';

interface UseSftpNavigationOptions {
  sessionId: string;
  username?: string;
  connected?: boolean;
}

export function useSftpNavigation({ sessionId, username, connected }: UseSftpNavigationOptions) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<SftpEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('');

  const initializedRef = useRef(false);
  const homePathRef = useRef<string | null>(null);
  const initRunRef = useRef(0);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    if (!connected) initializedRef.current = false;
  }, [connected]);

  useEffect(() => {
    initializedRef.current = false;
    homePathRef.current = null;
    initRunRef.current += 1;
    setSelectedEntry(null);
    setError(null);
  }, [sessionId, username]);

  const resolveReadableDir = useCallback(
    async (path: string): Promise<string | null> => {
      try {
        const resolved = await invoke<string>('sftp_realpath', { sessionId, path });
        return normalizeResolvedSftpDirectory(resolved || path);
      } catch {
        return null;
      }
    },
    [sessionId],
  );

  const resolveHomePath = useCallback(async (): Promise<string> => {
    if (homePathRef.current) return homePathRef.current;

    const candidates = getSftpHomeCandidates(username);
    const results = await Promise.all(candidates.map((c) => resolveReadableDir(c)));
    const preferred = results.find((r): r is string => r !== null);
    if (preferred) {
      homePathRef.current = preferred;
      return preferred;
    }

    for (const candidate of candidates) {
      try {
        await invoke<unknown[]>('sftp_list', { sessionId, path: candidate });
        homePathRef.current = candidate;
        return candidate;
      } catch {
        // Try next candidate.
      }
    }
    homePathRef.current = '/';
    return '/';
  }, [resolveReadableDir, sessionId, username]);

  useEffect(() => {
    if (!connected || initializedRef.current) return;
    initializedRef.current = true;

    let cancelled = false;
    const runId = ++initRunRef.current;
    const initWithPath = (dir: string) => {
      if (cancelled || runId !== initRunRef.current) return;
      setCurrentPath((prev) => (prev === dir ? prev : dir));
      setPathInput(dir);
    };
    resolveHomePath()
      .then(initWithPath)
      .catch(() => initWithPath('/'));

    return () => {
      cancelled = true;
    };
  }, [connected, resolveHomePath]);

  const loadDir = useCallback(
    async (path: string) => {
      const seq = ++loadSeqRef.current;
      setLoading(true);
      setError(null);
      try {
        const items = await invoke<SftpEntry[]>('sftp_list', { sessionId, path });
        if (seq !== loadSeqRef.current) return;
        setEntries(items);
        setSelectedEntry((selected) => {
          if (!selected) return null;
          return items.find((item) => item.path === selected.path) ?? null;
        });
        setPathInput(path);
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        setError(String(err));
        setEntries([]);
      } finally {
        if (seq === loadSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [sessionId],
  );

  useEffect(() => {
    if (currentPath) {
      void loadDir(currentPath);
    }
  }, [currentPath, loadDir]);

  const navigateTo = useCallback((path: string) => {
    const next = path || '/';
    setCurrentPath((prev) => (prev === next ? prev : next));
    setPathInput(next);
  }, []);

  const goUp = useCallback(() => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    navigateTo(parent);
  }, [currentPath, navigateTo]);

  const goHome = useCallback(() => {
    resolveHomePath()
      .then((path) => navigateTo(path))
      .catch(() => navigateTo('/'));
  }, [navigateTo, resolveHomePath]);

  const handlePathSubmit = useCallback(() => {
    setEditingPath(false);
    if (pathInput.trim()) {
      navigateTo(pathInput.trim());
    }
  }, [navigateTo, pathInput]);

  return {
    currentPath,
    entries,
    selectedEntry,
    setSelectedEntry,
    loading,
    error,
    setError,
    editingPath,
    setEditingPath,
    pathInput,
    setPathInput,
    loadDir,
    navigateTo,
    goUp,
    goHome,
    handlePathSubmit,
  };
}
