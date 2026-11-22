import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useAppStore } from '../../stores/appStore';
import { usePanelResize } from '../../hooks/usePanelResize';
import { useSftpNavigation } from '../../hooks/useSftpNavigation';
import { useSftpOperations } from '../../hooks/useSftpOperations';
import { formatPermissions, isTextFile, type SftpEntry } from '../../lib/sftpUtils';
import { SftpEditor } from './SftpEditor';
import { SftpContextMenu } from './SftpContextMenu';
import { SftpChmodDialog } from './SftpChmodDialog';
import { SftpToolbar } from './SftpToolbar';
import { SftpFileList } from './SftpFileList';

interface SftpPanelProps {
  sessionId: string;
  username?: string;
  connected?: boolean;
}

export const SftpPanel: React.FC<SftpPanelProps> = ({ sessionId, username, connected }) => {
  const toggleSftpPanel = useAppStore((s) => s.toggleSftpPanel);
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: SftpEntry | null;
  } | null>(null);

  const { width, onResizeMouseDown } = usePanelResize({
    initialWidth: 300,
    minWidth: 200,
    maxWidth: 600,
    edge: 'left',
  });

  const nav = useSftpNavigation({ sessionId, username, connected });
  const ops = useSftpOperations({
    sessionId,
    currentPath: nav.currentPath,
    loadDir: nav.loadDir,
    setError: nav.setError,
  });

  const uploadPathsRef = useRef(ops.handleUploadLocalPaths);
  uploadPathsRef.current = ops.handleUploadLocalPaths;

  // Support native OS drag-and-drop onto the SFTP panel to upload files/folders.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const isPointInsidePanel = (x: number, y: number): boolean => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return false;
      const dpr = window.devicePixelRatio || 1;
      const insidePhysical =
        x / dpr >= rect.left &&
        x / dpr <= rect.right &&
        y / dpr >= rect.top &&
        y / dpr <= rect.bottom;
      const insideLogical = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      return insideLogical || insidePhysical;
    };

    try {
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type === 'enter' || event.payload.type === 'over') {
            const pos = event.payload.position;
            setDragOver(isPointInsidePanel(pos.x, pos.y));
          } else if (event.payload.type === 'drop') {
            const pos = event.payload.position;
            const inside = isPointInsidePanel(pos.x, pos.y);
            setDragOver(false);
            if (inside && event.payload.paths.length > 0) {
              void uploadPathsRef.current(event.payload.paths);
            }
          } else {
            setDragOver(false);
          }
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    } catch {
      // Non-Tauri environment (e.g. unit/browser preview).
    }

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  const handleEntryDoubleClick = (entry: SftpEntry) => {
    nav.setSelectedEntry(entry);
    if (entry.is_dir) {
      nav.navigateTo(entry.path);
    } else if (isTextFile(entry.name)) {
      ops.setEditingFile(entry);
    } else {
      void ops.handleOpenLocal(entry);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, entry: SftpEntry | null) => {
    e.preventDefault();
    e.stopPropagation();
    nav.setSelectedEntry(entry);
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const { fileCount, folderCount } = useMemo(() => {
    let files = 0;
    let folders = 0;
    for (const e of nav.entries) {
      if (e.is_dir) folders += 1;
      else files += 1;
    }
    return { fileCount: files, folderCount: folders };
  }, [nav.entries]);

  return (
    <>
      <div className="sftp-resize-handle" onMouseDown={onResizeMouseDown} />
      <div
        ref={panelRef}
        className={`sftp-panel${dragOver ? ' sftp-panel-drag-over' : ''}`}
        style={{ width }}
      >
        <SftpToolbar
          currentPath={nav.currentPath}
          editingPath={nav.editingPath}
          pathInput={nav.pathInput}
          fileCount={fileCount}
          folderCount={folderCount}
          error={nav.error}
          busy={ops.busy}
          hasSelection={Boolean(nav.selectedEntry)}
          onClosePanel={toggleSftpPanel}
          onGoHome={nav.goHome}
          onGoUp={nav.goUp}
          onRefresh={() => {
            void nav.loadDir(nav.currentPath);
          }}
          onStartNewFolder={() => {
            ops.setNewFolderMode(true);
            ops.setNewFolderName('');
          }}
          onUpload={() => {
            void ops.handleUpload();
          }}
          onDownloadSelected={() => {
            if (nav.selectedEntry) void ops.handleDownload(nav.selectedEntry);
          }}
          onDeleteSelected={() => {
            if (nav.selectedEntry) void ops.handleDelete(nav.selectedEntry);
          }}
          onStartEditPath={() => nav.setEditingPath(true)}
          onPathInputChange={nav.setPathInput}
          onPathSubmit={nav.handlePathSubmit}
          onCancelEditPath={() => nav.setEditingPath(false)}
          onDismissError={() => nav.setError(null)}
        />

        <SftpFileList
          currentPath={nav.currentPath}
          entries={nav.entries}
          selectedEntry={nav.selectedEntry}
          loading={nav.loading}
          error={nav.error}
          progress={ops.progress}
          newFolderMode={ops.newFolderMode}
          newFolderName={ops.newFolderName}
          onNewFolderNameChange={ops.setNewFolderName}
          onCommitNewFolder={() => {
            void ops.handleNewFolder();
          }}
          onCancelNewFolder={() => ops.setNewFolderMode(false)}
          newFileMode={ops.newFileMode}
          newFileName={ops.newFileName}
          onNewFileNameChange={ops.setNewFileName}
          onCommitNewFile={() => {
            void ops.handleNewFile();
          }}
          onCancelNewFile={() => ops.setNewFileMode(false)}
          renamingEntry={ops.renamingEntry}
          renameValue={ops.renameValue}
          onRenameValueChange={ops.setRenameValue}
          onCommitRename={(entry) => {
            void ops.handleRename(entry);
          }}
          onCancelRename={() => ops.setRenamingEntry(null)}
          onGoUp={() => {
            nav.setSelectedEntry(null);
            nav.goUp();
          }}
          onEntryClick={nav.setSelectedEntry}
          onEntryDoubleClick={handleEntryDoubleClick}
          onContextMenu={handleContextMenu}
        />

        {contextMenu && (
          <SftpContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            entry={contextMenu.entry}
            currentPath={nav.currentPath}
            onClose={() => setContextMenu(null)}
            onEditOnline={(entry) => ops.setEditingFile(entry)}
            onOpenLocal={(entry) => {
              void ops.handleOpenLocal(entry);
            }}
            onDownload={(entry) => {
              void ops.handleDownload(entry);
            }}
            onUpload={() => {
              void ops.handleUpload();
            }}
            onUploadFolder={() => {
              void ops.handleUploadFolder();
            }}
            onRefresh={() => {
              void nav.loadDir(nav.currentPath);
            }}
            onCopyPath={ops.handleCopyPath}
            onStartRename={(entry) => {
              ops.setRenamingEntry(entry.path);
              ops.setRenameValue(entry.name);
            }}
            onStartChmod={(entry) => {
              ops.setChmodEntry(entry);
              ops.setChmodValue(formatPermissions(entry.permissions));
            }}
            onDelete={(entry) => {
              void ops.handleDelete(entry);
            }}
            onStartNewFolder={() => {
              ops.setNewFolderMode(true);
              ops.setNewFolderName('');
            }}
            onStartNewFile={() => {
              ops.setNewFileMode(true);
              ops.setNewFileName('');
            }}
          />
        )}

        {ops.chmodEntry && (
          <SftpChmodDialog
            entry={ops.chmodEntry}
            value={ops.chmodValue}
            onChange={ops.setChmodValue}
            onCancel={() => ops.setChmodEntry(null)}
            onConfirm={() => {
              void ops.handleChmod();
            }}
          />
        )}
      </div>

      {ops.editingFile && (
        <SftpEditor
          sessionId={sessionId}
          remotePath={ops.editingFile.path}
          fileName={ops.editingFile.name}
          onClose={() => ops.setEditingFile(null)}
          onSaved={() => {
            void nav.loadDir(nav.currentPath);
          }}
        />
      )}
    </>
  );
};
