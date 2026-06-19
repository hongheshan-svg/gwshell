import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { save, open } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Folder, File, Upload, Download, Trash2, FolderPlus,
  RefreshCw, ChevronUp, Home, Edit3, X, Copy,
  Shield, FilePlus, FolderUp, ExternalLink, FileEdit,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { fileIconFor } from '../../lib/fileIcons';
import { getSftpHomeCandidates, normalizeResolvedSftpDirectory } from '../../lib/sftpPaths';
import { SftpEditor } from './SftpEditor';

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1',
  'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'pl', 'php', 'lua', 'go', 'rs', 'java', 'kt', 'scala', 'c', 'cpp', 'h', 'hpp', 'cs',
  'css', 'scss', 'less', 'sass', 'html', 'htm', 'vue', 'svelte',
  'sql', 'graphql', 'gql',
  'env', 'gitignore', 'dockerignore', 'editorconfig', 'eslintrc', 'prettierrc',
  'log', 'csv', 'tsv', 'properties', 'service', 'timer', 'socket', 'desktop',
  'nginx', 'apache', 'Makefile', 'Dockerfile', 'Vagrantfile', 'Rakefile', 'Gemfile',
]);

function isTextFile(name: string): boolean {
  // dotfiles like .bashrc, .profile
  if (name.startsWith('.') && !name.includes('.', 1)) return true;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return TEXT_EXTENSIONS.has(ext);
}

interface SftpEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number | null;
  permissions: number | null;
}

interface SftpPanelProps {
  sessionId: string;
  username?: string;
  connected?: boolean;
}

/// Payload of the backend's `sftp-progress-{sessionId}` events.
interface SftpProgress {
  kind: 'upload' | 'download';
  file: string;
  fileIndex: number;
  fileTotal: number;
  bytes: number;
  total: number;
}

export const SftpPanel: React.FC<SftpPanelProps> = ({ sessionId, username, connected }) => {
  const { t } = useTranslation();
  const toggleSftpPanel = useAppStore((s) => s.toggleSftpPanel);

  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<SftpEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('');
  // Right-click context menu: on entry or on blank area
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; entry: SftpEntry | null;
  } | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFileMode, setNewFileMode] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  // chmod dialog
  const [chmodEntry, setChmodEntry] = useState<SftpEntry | null>(null);
  const [chmodValue, setChmodValue] = useState('');
  // inline editor
  const [editingFile, setEditingFile] = useState<SftpEntry | null>(null);
  const [width, setWidth] = useState(300);
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const initializedRef = useRef(false);
  const homePathRef = useRef<string | null>(null);
  const initRunRef = useRef(0);
  // Scroll container for the virtualized file list.
  const listScrollRef = useRef<HTMLDivElement>(null);
  // Guards file transfers so overlapping operations (double-click during a
  // transfer, spammed download/upload) can't run concurrently and corrupt
  // each other. The ref gives an immediate synchronous gate; `busy` drives UI.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const runExclusive = useCallback(async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  // Transfer progress (driven by backend sftp-progress events). The listener
  // stays armed for the panel's lifetime; events are only applied while a
  // transfer started from this panel is running (transferActiveRef), so stray
  // events (e.g. temp-file opens) don't flash a progress bar.
  const [progress, setProgress] = useState<SftpProgress | null>(null);
  const transferActiveRef = useRef(false);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<SftpProgress>(`sftp-progress-${sessionId}`, (e) => {
      if (transferActiveRef.current) setProgress(e.payload);
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [sessionId]);

  // Like runExclusive, but also scopes the progress bar to the transfer.
  const runTransfer = useCallback(async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    transferActiveRef.current = true;
    try {
      await fn();
    } finally {
      transferActiveRef.current = false;
      busyRef.current = false;
      setBusy(false);
      setProgress(null);
    }
  }, []);

  // Re-arm detection whenever the session drops its connection, so that a
  // (re)connect runs the directory detection again instead of staying stuck
  // on a stale error from before the SSH session was ready.
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
      // Use sftp_realpath (one lightweight round-trip, and it does NOT go
      // through the reopen-and-retry with_sftp path) to canonicalize a
      // candidate and confirm it exists. We deliberately do NOT sftp_list here:
      // a full directory read just to verify readability was the main cause of
      // slow first-load (several candidates × list round-trips, with the result
      // discarded). loadDir() does the one real list after we pick a home.
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

    // Probe candidates IN PARALLEL and take the first that resolves, instead
    // of awaiting them serially. Each probe is a single realpath round-trip, so
    // the whole detection finishes in ~1 RTT instead of N×RTT. (Implemented
    // without Promise.any — the TS lib target is ES2020.)
    const probes = candidates;
    try {
      const resolved = await new Promise<string>((resolve, reject) => {
        let remaining = probes.length;
        if (remaining === 0) { reject(new Error('no candidates')); return; }
        for (const c of probes) {
          resolveReadableDir(c).then((r) => {
            if (r) resolve(r);
            else if (--remaining === 0) reject(new Error('all unresolved'));
          }).catch(() => {
            if (--remaining === 0) reject(new Error('all unresolved'));
          });
        }
      });
      homePathRef.current = resolved;
      return resolved;
    } catch {
      // Some servers don't support canonicalize/realpath for otherwise
      // readable directories. Fall back to list probes, but still never use a
      // literal "~" path; SFTP is not a shell and many servers treat it as a
      // real child directory name.
      // Fall back to serial lightweight list probes so we don't accept an
      // unreadable candidate from a failed realpath.
      for (const candidate of probes) {
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
    }
  }, [resolveReadableDir, username]);

  // Detect the initial directory once the SSH session is actually connected.
  // Gating on `connected` (instead of a fixed mount-time retry window) means
  // the panel loads as soon as auth + handshake finish, however long that
  // takes — and recovers automatically if the panel mounted before the
  // connection was ready.
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
      setLoading(true);
      setError(null);
      try {
        const items = await invoke<SftpEntry[]>('sftp_list', { sessionId, path });
        setEntries(items);
        setSelectedEntry((selected) => {
          if (!selected) return null;
          return items.find((item) => item.path === selected.path) ?? null;
        });
        setPathInput(path);
      } catch (err) {
        setError(String(err));
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    if (currentPath) {
      loadDir(currentPath);
    }
  }, [currentPath, loadDir]);

  const navigateTo = (path: string) => {
    const next = path || '/';
    setCurrentPath((prev) => (prev === next ? prev : next));
    setPathInput(next);
  };

  const goUp = () => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    navigateTo(parent);
  };

  const goHome = () => {
    resolveHomePath()
      .then((path) => navigateTo(path))
      .catch(() => navigateTo('/'));
  };

  const handlePathSubmit = () => {
    setEditingPath(false);
    if (pathInput.trim()) {
      navigateTo(pathInput.trim());
    }
  };

  const handleEntryClick = (entry: SftpEntry) => {
    setSelectedEntry(entry);
  };

  const handleEntryDoubleClick = async (entry: SftpEntry) => {
    setSelectedEntry(entry);
    if (entry.is_dir) {
      navigateTo(entry.path);
    } else if (isTextFile(entry.name)) {
      setEditingFile(entry);
    } else {
      handleOpenLocal(entry);
    }
  };

  const handleOpenLocal = (entry: SftpEntry) =>
    runExclusive(async () => {
      try {
        const tempPath = await invoke<string>('sftp_open_file', {
          sessionId,
          remotePath: entry.path,
        });
        await openPath(tempPath);
      } catch (err) {
        setError(String(err));
      }
    });

  const handleDownload = (entry: SftpEntry) =>
    runTransfer(async () => {
      try {
        if (entry.is_dir) {
          // Pick a destination folder; the backend creates `{dest}/{entry.name}`.
          const dir = await open({ directory: true });
          if (typeof dir !== 'string' || !dir) return;
          await invoke('sftp_download_dir', {
            sessionId,
            remotePath: entry.path,
            localDir: dir,
          });
        } else {
          const localPath = await save({ defaultPath: entry.name });
          if (!localPath) return;
          await invoke('sftp_download', {
            sessionId,
            remotePath: entry.path,
            localPath,
          });
        }
      } catch (err) {
        setError(String(err));
      }
    });

  const handleUpload = () =>
    runTransfer(async () => {
      try {
        const selected = await open({ multiple: true });
        if (!selected) return;
        const files = Array.isArray(selected) ? selected : [selected];
        for (const fileEntry of files) {
          const path = typeof fileEntry === 'string' ? fileEntry : (fileEntry as { path: string }).path;
          const fileName = path.replace(/\\/g, '/').split('/').pop() || 'file';
          const remotePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
          await invoke('sftp_upload', { sessionId, remotePath, localPath: path });
        }
        loadDir(currentPath);
      } catch (err) {
        setError(String(err));
      }
    });

  const handleUploadFolder = () =>
    runTransfer(async () => {
      try {
        const selected = await open({ directory: true });
        if (typeof selected !== 'string' || !selected) return;
        // The backend creates `{currentPath}/{local dir basename}` remotely.
        await invoke('sftp_upload_dir', {
          sessionId,
          remotePath: currentPath,
          localDir: selected,
        });
        loadDir(currentPath);
      } catch (err) {
        setError(String(err));
      }
    });

  const handleDelete = async (entry: SftpEntry) => {
    // Remote deletion is irreversible (no recycle bin) — confirm first.
    if (!window.confirm(t('common_delete_confirm_body', { name: entry.name }))) {
      return;
    }
    try {
      if (entry.is_dir) {
        await invoke('sftp_rmdir', { sessionId, path: entry.path });
      } else {
        await invoke('sftp_delete_file', { sessionId, path: entry.path });
      }
      loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleRename = async (entry: SftpEntry) => {
    if (!renameValue.trim() || renameValue === entry.name) {
      setRenamingEntry(null);
      return;
    }
    const parentDir = entry.path.replace(/\/[^/]+$/, '') || '/';
    const newPath = parentDir === '/' ? `/${renameValue}` : `${parentDir}/${renameValue}`;
    try {
      await invoke('sftp_rename', { sessionId, oldPath: entry.path, newPath });
      setRenamingEntry(null);
      loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleNewFolder = async () => {
    if (!newFolderName.trim()) {
      setNewFolderMode(false);
      return;
    }
    const path =
      currentPath === '/'
        ? `/${newFolderName.trim()}`
        : `${currentPath}/${newFolderName.trim()}`;
    try {
      await invoke('sftp_mkdir', { sessionId, path });
      setNewFolderMode(false);
      setNewFolderName('');
      loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleNewFile = async () => {
    if (!newFileName.trim()) {
      setNewFileMode(false);
      return;
    }
    const path =
      currentPath === '/'
        ? `/${newFileName.trim()}`
        : `${currentPath}/${newFileName.trim()}`;
    try {
      await invoke('sftp_create_file', { sessionId, path });
      setNewFileMode(false);
      setNewFileName('');
      loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleCopyPath = (pathToCopy: string) => {
    navigator.clipboard.writeText(pathToCopy).catch(() => {});
  };

  const handleChmod = async () => {
    if (!chmodEntry || !chmodValue.trim()) {
      setChmodEntry(null);
      return;
    }
    const mode = parseInt(chmodValue, 8);
    if (isNaN(mode) || mode < 0 || mode > 0o7777) {
      setError(t('sftp_chmod_invalid'));
      setChmodEntry(null);
      return;
    }
    try {
      await invoke('sftp_chmod', { sessionId, path: chmodEntry.path, mode });
      setChmodEntry(null);
      setChmodValue('');
      loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  const downloadSelected = () => {
    if (!selectedEntry) return;
    handleDownload(selectedEntry);
  };

  const deleteSelected = () => {
    if (!selectedEntry) return;
    handleDelete(selectedEntry);
  };

  // Right-click on entry or blank area
  const handleContextMenu = (e: React.MouseEvent, entry: SftpEntry | null) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedEntry(entry);
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  // Resize handle
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = width;

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = startXRef.current - ev.clientX;
      setWidth(Math.max(200, Math.min(600, startWidthRef.current + delta)));
    };

    const onMouseUp = () => {
      resizingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '-';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  };

  const formatPermissions = (perm: number | null): string => {
    if (perm === null) return '';
    const mode = perm & 0o777;
    return mode.toString(8);
  };

  // Counts are memoized so a re-render triggered by something other than the
  // entries list (e.g. resizing the panel width) doesn't re-scan the whole list.
  const { fileCount, folderCount } = useMemo(() => {
    let files = 0;
    let folders = 0;
    for (const e of entries) {
      if (e.is_dir) folders += 1;
      else files += 1;
    }
    return { fileCount: files, folderCount: folders };
  }, [entries]);

  // Virtualize the file list so large directories (thousands of entries) only
  // render the visible rows instead of mounting the whole list as DOM.
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 32, // matches .sftp-file-item min-height
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <>
      <div className="sftp-resize-handle" onMouseDown={onResizeMouseDown} />
      <div className="sftp-panel" style={{ width }}>
        {/* Header */}
        <div className="sftp-header">
          <span className="sftp-title">{t('sftp_title')}</span>
          <button className="sftp-header-btn" onClick={toggleSftpPanel} title={t('sftp_close')}>
            <X size={14} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="sftp-toolbar">
          <button className="sftp-tool-btn" onClick={goHome} title={t('sftp_home')}>
            <Home size={14} />
          </button>
          <button className="sftp-tool-btn" onClick={goUp} title={t('sftp_parent')}>
            <ChevronUp size={14} />
          </button>
          <button className="sftp-tool-btn" onClick={() => loadDir(currentPath)} title={t('sftp_refresh')}>
            <RefreshCw size={14} />
          </button>
          <div className="sftp-toolbar-sep" />
          <button className="sftp-tool-btn" onClick={() => { setNewFolderMode(true); setNewFolderName(''); }} title={t('sftp_new_folder')}>
            <FolderPlus size={14} />
          </button>
          <button className="sftp-tool-btn" onClick={handleUpload} disabled={busy} title={t('sftp_upload')}>
            <Upload size={14} />
          </button>
          <div className="sftp-toolbar-sep" />
          <button className="sftp-tool-btn" onClick={downloadSelected} disabled={!selectedEntry || busy} title={t('sftp_download')}>
            <Download size={14} />
          </button>
          <button className="sftp-tool-btn sftp-tool-btn-danger" onClick={deleteSelected} disabled={!selectedEntry || busy} title={t('sftp_delete')}>
            <Trash2 size={14} />
          </button>
        </div>

        {/* Path bar */}
        <div className="sftp-pathbar">
          {editingPath ? (
            <input
              className="sftp-path-input"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onBlur={handlePathSubmit}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePathSubmit(); if (e.key === 'Escape') setEditingPath(false); }}
              autoFocus
            />
          ) : (
            <div className="sftp-path-display" onClick={() => setEditingPath(true)} title={currentPath}>
              {currentPath}
            </div>
          )}
        </div>

        {/* Info bar */}
        <div className="sftp-infobar">
          {t('sftp_info', { files: fileCount, folders: folderCount })}
        </div>

        {/* Error */}
        {error && (
          <div className="sftp-error">
            {error}
            <button className="sftp-error-close" onClick={() => setError(null)}>
              <X size={12} />
            </button>
          </div>
        )}

        {/* File list */}
        <div
          className="sftp-file-list"
          ref={listScrollRef}
          onContextMenu={(e) => handleContextMenu(e, null)}
        >
          {loading && entries.length === 0 && (
            <div className="sftp-loading">{t('sftp_loading')}</div>
          )}

          {/* Column header — aligns with .sftp-file-item rows below */}
          {!loading && entries.length > 0 && (
            <div className="sftp-file-header">
              <span className="sftp-file-header-icon" />
              <span className="sftp-file-header-name">{t('sftp_col_name')}</span>
              <span className="sftp-file-header-size">{t('sftp_col_size')}</span>
              <span className="sftp-file-header-perm">{t('sftp_col_perm')}</span>
            </div>
          )}

          {/* New folder input */}
          {newFolderMode && (
            <div className="sftp-file-item sftp-new-folder-item">
              <Folder size={17} className="sftp-icon sftp-icon-folder" />
              <input
                className="sftp-rename-input"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onBlur={handleNewFolder}
                onKeyDown={(e) => { if (e.key === 'Enter') handleNewFolder(); if (e.key === 'Escape') setNewFolderMode(false); }}
                placeholder={t('sftp_folder_name')}
                autoFocus
              />
            </div>
          )}

          {/* New file input */}
          {newFileMode && (
            <div className="sftp-file-item sftp-new-folder-item">
              <File size={16} className="sftp-icon sftp-icon-file" />
              <input
                className="sftp-rename-input"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onBlur={handleNewFile}
                onKeyDown={(e) => { if (e.key === 'Enter') handleNewFile(); if (e.key === 'Escape') setNewFileMode(false); }}
                placeholder={t('sftp_file_name')}
                autoFocus
              />
            </div>
          )}

          {/* Parent directory entry */}
          {currentPath !== '/' && (
            <div
              className="sftp-file-item sftp-file-dir"
              role="button"
              tabIndex={0}
              aria-label=".."
              onClick={() => { setSelectedEntry(null); goUp(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedEntry(null); goUp(); } }}
            >
              <FolderUp size={17} className="sftp-icon sftp-icon-folder" />
              <span className="sftp-file-name">..</span>
              <span className="sftp-file-size">-</span>
              <span className="sftp-file-perm" />
            </div>
          )}

          <div
            className="sftp-virtual-list"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {virtualRows.map((virtualRow) => {
              const entry = entries[virtualRow.index];
              if (!entry) return null;
              return (
                <div
                  key={entry.path}
                  className={`sftp-file-item sftp-virtual-row ${entry.is_dir ? 'sftp-file-dir' : ''} ${selectedEntry?.path === entry.path ? 'sftp-file-item-selected' : ''}`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                  role="button"
                  tabIndex={0}
                  aria-label={entry.name}
                  onClick={() => handleEntryClick(entry)}
                  onDoubleClick={() => handleEntryDoubleClick(entry)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleEntryDoubleClick(entry); } }}
                  onContextMenu={(e) => handleContextMenu(e, entry)}
                >
                  {entry.is_dir ? (
                    <Folder size={17} className="sftp-icon sftp-icon-folder" />
                  ) : (() => {
                    const { Icon, cls } = fileIconFor(entry.name);
                    return <Icon size={16} className={`sftp-icon ${cls}`} />;
                  })()}
                  {renamingEntry === entry.path ? (
                    <input
                      className="sftp-rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => handleRename(entry)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRename(entry); if (e.key === 'Escape') setRenamingEntry(null); }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <span className="sftp-file-name" title={entry.name}>{entry.name}</span>
                      <span className="sftp-file-size">{entry.is_dir ? '' : formatSize(entry.size)}</span>
                      <span className="sftp-file-perm">{formatPermissions(entry.permissions)}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {!loading && entries.length === 0 && !error && (
            <div className="sftp-empty">{t('sftp_empty')}</div>
          )}
        </div>

        {/* Transfer progress */}
        {progress && (
          <div className="sftp-progress">
            <div className="sftp-progress-info">
              <span className="sftp-progress-name" title={progress.file}>
                {(progress.kind === 'upload' ? '↑ ' : '↓ ') + (progress.file.split('/').pop() || progress.file)}
              </span>
              {progress.fileTotal > 1 && (
                <span className="sftp-progress-count">{progress.fileIndex}/{progress.fileTotal}</span>
              )}
              <span className="sftp-progress-pct">
                {progress.total > 0
                  ? `${Math.min(100, Math.round((progress.bytes / progress.total) * 100))}%`
                  : formatSize(progress.bytes)}
              </span>
            </div>
            <div className="sftp-progress-track">
              <div
                className="sftp-progress-bar"
                style={{ width: `${progress.total > 0 ? Math.min(100, (progress.bytes / progress.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Status */}
        <div className="sftp-status">
          {t('sftp_item_count', { count: entries.length })}
        </div>

        {/* Context menu */}
        {contextMenu && (
          <div
            className="sftp-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.entry ? (
              <>
                {/* --- Entry-level right-click --- */}
                {!contextMenu.entry.is_dir && (
                  <>
                    {isTextFile(contextMenu.entry.name) && (
                      <div
                        className="sftp-context-item"
                        onClick={() => { setEditingFile(contextMenu.entry!); setContextMenu(null); }}
                      >
                        <FileEdit size={13} />
                        <span>{t('sftp_edit_online')}</span>
                      </div>
                    )}
                    <div
                      className="sftp-context-item"
                      onClick={() => { handleOpenLocal(contextMenu.entry!); setContextMenu(null); }}
                    >
                      <ExternalLink size={13} />
                      <span>{t('sftp_open_local')}</span>
                    </div>
                  </>
                )}
                <div
                  className="sftp-context-item"
                  onClick={() => { handleDownload(contextMenu.entry!); setContextMenu(null); }}
                >
                  <Download size={13} />
                  <span>{t('sftp_download_to')}</span>
                </div>
                <div
                  className="sftp-context-item"
                  onClick={() => { handleUpload(); setContextMenu(null); }}
                >
                  <Upload size={13} />
                  <span>{t('sftp_upload_file')}</span>
                </div>
                <div
                  className="sftp-context-item"
                  onClick={() => { handleUploadFolder(); setContextMenu(null); }}
                >
                  <FolderUp size={13} />
                  <span>{t('sftp_upload_folder')}</span>
                </div>
                <div className="sftp-context-divider" />
                <div
                  className="sftp-context-item"
                  onClick={() => { loadDir(currentPath); setContextMenu(null); }}
                >
                  <RefreshCw size={13} />
                  <span>{t('sftp_refresh')}</span>
                </div>
                <div className="sftp-context-divider" />
                <div
                  className="sftp-context-item"
                  onClick={() => { handleCopyPath(contextMenu.entry!.path); setContextMenu(null); }}
                >
                  <Copy size={13} />
                  <span>{t('sftp_copy_path')}</span>
                </div>
                <div
                  className="sftp-context-item"
                  onClick={() => {
                    setRenamingEntry(contextMenu.entry!.path);
                    setRenameValue(contextMenu.entry!.name);
                    setContextMenu(null);
                  }}
                >
                  <Edit3 size={13} />
                  <span>{t('sftp_rename')}</span>
                </div>
                <div
                  className="sftp-context-item"
                  onClick={() => {
                    setChmodEntry(contextMenu.entry!);
                    setChmodValue(formatPermissions(contextMenu.entry!.permissions));
                    setContextMenu(null);
                  }}
                >
                  <Shield size={13} />
                  <span>{t('sftp_chmod')}</span>
                </div>
                <div className="sftp-context-divider" />
                <div
                  className="sftp-context-item sftp-context-danger"
                  onClick={() => { handleDelete(contextMenu.entry!); setContextMenu(null); }}
                >
                  <Trash2 size={13} />
                  <span>{t('sftp_delete')}</span>
                </div>
              </>
            ) : (
              <>
                {/* --- Blank area right-click --- */}
                <div
                  className="sftp-context-item"
                  onClick={() => { loadDir(currentPath); setContextMenu(null); }}
                >
                  <RefreshCw size={13} />
                  <span>{t('sftp_refresh')}</span>
                </div>
                <div className="sftp-context-divider" />
                <div
                  className="sftp-context-item"
                  onClick={() => { handleCopyPath(currentPath); setContextMenu(null); }}
                >
                  <Copy size={13} />
                  <span>{t('sftp_copy_path')}</span>
                </div>
                <div
                  className="sftp-context-item"
                  onClick={() => { setNewFolderMode(true); setNewFolderName(''); setContextMenu(null); }}
                >
                  <FolderPlus size={13} />
                  <span>{t('sftp_new_folder')}</span>
                </div>
                <div
                  className="sftp-context-item"
                  onClick={() => { setNewFileMode(true); setNewFileName(''); setContextMenu(null); }}
                >
                  <FilePlus size={13} />
                  <span>{t('sftp_new_file')}</span>
                </div>
                <div className="sftp-context-divider" />
                <div
                  className="sftp-context-item"
                  onClick={() => { handleUpload(); setContextMenu(null); }}
                >
                  <Upload size={13} />
                  <span>{t('sftp_upload_file')}</span>
                </div>
                <div
                  className="sftp-context-item"
                  onClick={() => { handleUploadFolder(); setContextMenu(null); }}
                >
                  <FolderUp size={13} />
                  <span>{t('sftp_upload_folder')}</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Chmod dialog */}
        {chmodEntry && (
          <div className="sftp-chmod-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setChmodEntry(null); }}>
            <div className="sftp-chmod-dialog">
              <div className="sftp-chmod-title">{t('sftp_chmod')}</div>
              <div className="sftp-chmod-filename">{chmodEntry.name}</div>
              <div className="sftp-chmod-row">
                <label>{t('sftp_chmod_label')}</label>
                <input
                  className="sftp-chmod-input"
                  value={chmodValue}
                  onChange={(e) => setChmodValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleChmod(); if (e.key === 'Escape') setChmodEntry(null); }}
                  placeholder="755"
                  maxLength={4}
                  autoFocus
                />
              </div>
              <div className="sftp-chmod-actions">
                <button className="sftp-chmod-btn sftp-chmod-cancel" onClick={() => setChmodEntry(null)}>
                  {t('sftp_cancel')}
                </button>
                <button className="sftp-chmod-btn sftp-chmod-ok" onClick={handleChmod}>
                  {t('sftp_confirm')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Inline text editor */}
      {editingFile && (
        <SftpEditor
          sessionId={sessionId}
          remotePath={editingFile.path}
          fileName={editingFile.name}
          onClose={() => setEditingFile(null)}
        />
      )}
    </>
  );
};
