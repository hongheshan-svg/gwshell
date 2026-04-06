import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import {
  Folder, File, Upload, Download, Trash2, FolderPlus,
  RefreshCw, ChevronUp, Home, Edit3, X, Copy,
  Shield, FilePlus, FolderUp,
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
  username?: string;
}

export const SftpPanel: React.FC<SftpPanelProps> = ({ sessionId, username }) => {
  const t = useAppStore((s) => s.t);
  const toggleSftpPanel = useAppStore((s) => s.toggleSftpPanel);

  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
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
  const [width, setWidth] = useState(300);
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const initializedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect initial directory with retry: SSH may not be connected yet when SFTP panel mounts
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const tryInit = (retriesLeft: number) => {
      const homeDir = username ? `/home/${username}` : null;
      const initWithPath = (dir: string) => {
        setCurrentPath(dir);
        setPathInput(dir);
      };
      const doFallback = () => {
        invoke<string>('sftp_realpath', { sessionId, path: '.' })
          .then((p) => initWithPath(p))
          .catch(() => initWithPath('/'));
      };
      const retryOrFallback = () => {
        if (retriesLeft > 0) {
          retryTimerRef.current = setTimeout(() => tryInit(retriesLeft - 1), 1000);
        } else {
          initWithPath('/');
        }
      };

      if (homeDir) {
        invoke<unknown[]>('sftp_list', { sessionId, path: homeDir })
          .then(() => initWithPath(homeDir))
          .catch((err) => {
            const errStr = String(err);
            if (errStr.includes('Session not found') || errStr.includes('not found')) {
              // SSH not connected yet, retry
              retryOrFallback();
            } else {
              // Home dir doesn't exist, try realpath
              doFallback();
            }
          });
      } else {
        invoke<string>('sftp_realpath', { sessionId, path: '.' })
          .then((p) => initWithPath(p))
          .catch((err) => {
            const errStr = String(err);
            if (errStr.includes('Session not found') || errStr.includes('not found')) {
              retryOrFallback();
            } else {
              initWithPath('/');
            }
          });
      }
    };

    tryInit(10); // retry up to 10 times (10 seconds)

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [sessionId, username]);

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
    if (username) {
      navigateTo(`/home/${username}`);
    } else {
      invoke<string>('sftp_realpath', { sessionId, path: '.' })
        .then((p) => navigateTo(p))
        .catch(() => navigateTo('/'));
    }
  };

  const handlePathSubmit = () => {
    setEditingPath(false);
    if (pathInput.trim()) {
      navigateTo(pathInput.trim());
    }
  };

  const handleEntryClick = (_entry: SftpEntry) => {
    // Single click: select only, no navigation
  };

  const handleEntryDoubleClick = async (entry: SftpEntry) => {
    if (entry.is_dir) {
      navigateTo(entry.path);
    } else {
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
        await invoke('sftp_upload', { sessionId, remotePath, localPath: path });
      }
      loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleUploadFolder = async () => {
    try {
      const selected = await open({ directory: true });
      if (!selected) return;
      setError(t('sftp_folder_upload_hint'));
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

  // Right-click on entry or blank area
  const handleContextMenu = (e: React.MouseEvent, entry: SftpEntry | null) => {
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

  const fileCount = entries.filter((e) => !e.is_dir).length;
  const folderCount = entries.filter((e) => e.is_dir).length;

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
          <button className="sftp-tool-btn" onClick={() => { setNewFileMode(true); setNewFileName(''); }} title={t('sftp_new_file')}>
            <FilePlus size={14} />
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
          onContextMenu={(e) => handleContextMenu(e, null)}
        >
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

          {/* New file input */}
          {newFileMode && (
            <div className="sftp-file-item sftp-new-folder-item">
              <File size={14} className="sftp-icon sftp-icon-file" />
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
              onClick={goUp}
            >
              <FolderUp size={14} className="sftp-icon sftp-icon-folder" />
              <span className="sftp-file-name">..</span>
              <span className="sftp-file-size">-</span>
              <span className="sftp-file-perm" />
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
            {contextMenu.entry ? (
              <>
                {/* --- Entry-level right-click --- */}
                {!contextMenu.entry.is_dir && (
                  <div
                    className="sftp-context-item"
                    onClick={() => { handleDownload(contextMenu.entry!); setContextMenu(null); }}
                  >
                    <Download size={13} />
                    <span>{t('sftp_download_to')}</span>
                  </div>
                )}
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
    </>
  );
};
