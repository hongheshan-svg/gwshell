import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import {
  Folder, File, Upload, Download, Trash2, FolderPlus,
  RefreshCw, ChevronUp, Home, Edit3, X,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

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
}

export const SftpPanel: React.FC<SftpPanelProps> = ({ sessionId }) => {
  const t = useAppStore((s) => s.t);
  const toggleSftpPanel = useAppStore((s) => s.toggleSftpPanel);

  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('/');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: SftpEntry } | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [width, setWidth] = useState(300);
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const initializedRef = useRef(false);

  // Resolve home directory on first load
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    invoke<string>('sftp_realpath', { sessionId, path: '.' })
      .then((homePath) => {
        setCurrentPath(homePath);
        setPathInput(homePath);
      })
      .catch(() => {
        // Fallback to root
        setCurrentPath('/');
        setPathInput('/');
      });
  }, [sessionId]);

  const loadDir = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const items = await invoke<SftpEntry[]>('sftp_list', { sessionId, path });
        setEntries(items);
        setCurrentPath(path);
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

  // Load directory when path changes
  useEffect(() => {
    if (currentPath) {
      loadDir(currentPath);
    }
  }, [currentPath, loadDir]);

  const navigateTo = (path: string) => {
    setCurrentPath(path);
  };

  const goUp = () => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    navigateTo(parent);
  };

  const goHome = () => {
    invoke<string>('sftp_realpath', { sessionId, path: '.' })
      .then((p) => navigateTo(p))
      .catch(() => navigateTo('/'));
  };

  const handlePathSubmit = () => {
    setEditingPath(false);
    if (pathInput.trim()) {
      navigateTo(pathInput.trim());
    }
  };

  const handleEntryClick = (entry: SftpEntry) => {
    if (entry.is_dir) {
      navigateTo(entry.path);
    }
  };

  const handleEntryDoubleClick = async (entry: SftpEntry) => {
    if (!entry.is_dir) {
      await handleDownload(entry);
    }
  };

  const handleDownload = async (entry: SftpEntry) => {
    try {
      const localPath = await save({ defaultPath: entry.name });
      if (localPath) {
        await invoke('sftp_download', {
          sessionId,
          remotePath: entry.path,
          localPath,
        });
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleUpload = async () => {
    try {
      const selected = await open({ multiple: true });
      if (!selected) return;
      const files = Array.isArray(selected) ? selected : [selected];
      for (const fileEntry of files) {
        const path = typeof fileEntry === 'string' ? fileEntry : (fileEntry as { path: string }).path;
        const fileName = path.replace(/\\/g, '/').split('/').pop() || 'file';
        const remotePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
        await invoke('sftp_upload', {
          sessionId,
          remotePath,
          localPath: path,
        });
      }
      loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDelete = async (entry: SftpEntry) => {
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

  const handleContextMenu = (e: React.MouseEvent, entry: SftpEntry) => {
    e.preventDefault();
    e.stopPropagation();
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
          <button className="sftp-tool-btn" onClick={handleUpload} title={t('sftp_upload')}>
            <Upload size={14} />
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
        <div className="sftp-file-list">
          {loading && entries.length === 0 && (
            <div className="sftp-loading">{t('sftp_loading')}</div>
          )}

          {/* New folder input */}
          {newFolderMode && (
            <div className="sftp-file-item sftp-new-folder-item">
              <Folder size={14} className="sftp-icon sftp-icon-folder" />
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

          {entries.map((entry) => (
            <div
              key={entry.path}
              className={`sftp-file-item ${entry.is_dir ? 'sftp-file-dir' : ''}`}
              onClick={() => handleEntryClick(entry)}
              onDoubleClick={() => handleEntryDoubleClick(entry)}
              onContextMenu={(e) => handleContextMenu(e, entry)}
            >
              {entry.is_dir ? (
                <Folder size={14} className="sftp-icon sftp-icon-folder" />
              ) : (
                <File size={14} className="sftp-icon sftp-icon-file" />
              )}
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
          ))}

          {!loading && entries.length === 0 && !error && (
            <div className="sftp-empty">{t('sftp_empty')}</div>
          )}
        </div>

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
            {!contextMenu.entry.is_dir && (
              <div
                className="sftp-context-item"
                onClick={() => { handleDownload(contextMenu.entry); setContextMenu(null); }}
              >
                <Download size={13} />
                <span>{t('sftp_download')}</span>
              </div>
            )}
            <div
              className="sftp-context-item"
              onClick={() => {
                setRenamingEntry(contextMenu.entry.path);
                setRenameValue(contextMenu.entry.name);
                setContextMenu(null);
              }}
            >
              <Edit3 size={13} />
              <span>{t('sftp_rename')}</span>
            </div>
            <div className="sftp-context-divider" />
            <div
              className="sftp-context-item sftp-context-danger"
              onClick={() => { handleDelete(contextMenu.entry); setContextMenu(null); }}
            >
              <Trash2 size={13} />
              <span>{t('sftp_delete')}</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
