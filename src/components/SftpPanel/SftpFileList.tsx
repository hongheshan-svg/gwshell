import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { SftpEntryIcon } from './SftpEntryIcon';
import {
  formatPermissions,
  formatSize,
  type SftpEntry,
  type SftpProgress,
} from '../../lib/sftpUtils';

const CLICK_MOVE_THRESHOLD_PX = 5;
const DOUBLE_CLICK_MAX_DISTANCE_PX = 8;
const DOUBLE_CLICK_MAX_INTERVAL_MS = 450;
const NAV_SETTLE_COOLDOWN_MS = 350;
const PARENT_ROW_KEY = '__parent__';

interface SftpFileListProps {
  currentPath: string;
  entries: SftpEntry[];
  selectedEntry: SftpEntry | null;
  loading: boolean;
  error: string | null;
  progress: SftpProgress | null;
  newFolderMode: boolean;
  newFolderName: string;
  onNewFolderNameChange: (val: string) => void;
  onCommitNewFolder: () => void;
  onCancelNewFolder: () => void;
  newFileMode: boolean;
  newFileName: string;
  onNewFileNameChange: (val: string) => void;
  onCommitNewFile: () => void;
  onCancelNewFile: () => void;
  renamingEntry: string | null;
  renameValue: string;
  onRenameValueChange: (val: string) => void;
  onCommitRename: (entry: SftpEntry) => void;
  onCancelRename: () => void;
  onGoUp: () => void;
  onEntryClick: (entry: SftpEntry | null) => void;
  onEntryDoubleClick: (entry: SftpEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: SftpEntry | null) => void;
}

export const SftpFileList: React.FC<SftpFileListProps> = ({
  currentPath,
  entries,
  selectedEntry,
  loading,
  error,
  progress,
  newFolderMode,
  newFolderName,
  onNewFolderNameChange,
  onCommitNewFolder,
  onCancelNewFolder,
  newFileMode,
  newFileName,
  onNewFileNameChange,
  onCommitNewFile,
  onCancelNewFile,
  renamingEntry,
  renameValue,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onGoUp,
  onEntryClick,
  onEntryDoubleClick,
  onContextMenu,
}) => {
  const { t } = useTranslation();
  const listScrollRef = useRef<HTMLDivElement>(null);
  const [parentSelected, setParentSelected] = useState(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const firstClickRef = useRef<{ key: string; x: number; y: number; time: number } | null>(null);
  const navSettledUntilRef = useRef<number>(0);
  const prevLoadingRef = useRef(loading);

  // When directory changes: reset scroll to top, clear parent selection, and
  // start a short settle cooldown so a stray click/triple-click on the newly
  // rendered rows under the cursor can't accidentally open them.
  useEffect(() => {
    setParentSelected(false);
    firstClickRef.current = null;
    navSettledUntilRef.current = Date.now() + NAV_SETTLE_COOLDOWN_MS;
    if (listScrollRef.current) {
      listScrollRef.current.scrollTop = 0;
    }
  }, [currentPath]);

  // Also arm the settle cooldown once async directory loading finishes, because
  // slow SSH responses can complete after the currentPath change cooldown.
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      firstClickRef.current = null;
      navSettledUntilRef.current = Date.now() + NAV_SETTLE_COOLDOWN_MS;
    }
    prevLoadingRef.current = loading;
  }, [loading]);

  const recordPointerDown = (e: React.MouseEvent) => {
    if (e.button !== 0) {
      pointerDownPosRef.current = null;
      return;
    }
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const isStationaryClick = (e: React.MouseEvent): boolean => {
    const start = pointerDownPosRef.current;
    if (!start) return true;
    return (
      Math.abs(e.clientX - start.x) <= CLICK_MOVE_THRESHOLD_PX &&
      Math.abs(e.clientY - start.y) <= CLICK_MOVE_THRESHOLD_PX
    );
  };

  const recordRowClick = (key: string, e: React.MouseEvent) => {
    if (e.detail <= 1) {
      firstClickRef.current = { key, x: e.clientX, y: e.clientY, time: Date.now() };
    }
  };

  const canActivateRow = (key: string, e: React.MouseEvent): boolean => {
    if (loading || renamingEntry !== null) return false;
    const now = Date.now();
    if (now < navSettledUntilRef.current) return false;
    if (!isStationaryClick(e)) return false;

    const first = firstClickRef.current;
    firstClickRef.current = null;
    if (!first) return false;
    if (first.key !== key) return false;
    if (now - first.time > DOUBLE_CLICK_MAX_INTERVAL_MS) return false;
    return (
      Math.abs(e.clientX - first.x) <= DOUBLE_CLICK_MAX_DISTANCE_PX &&
      Math.abs(e.clientY - first.y) <= DOUBLE_CLICK_MAX_DISTANCE_PX
    );
  };

  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 34,
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <>
      <div
        className="sftp-file-list"
        ref={listScrollRef}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setParentSelected(false);
            firstClickRef.current = null;
            onEntryClick(null);
          }
        }}
        onContextMenu={(e) => onContextMenu(e, null)}
      >
        {loading && entries.length === 0 && <div className="sftp-loading">{t('sftp_loading')}</div>}

        {!loading && entries.length > 0 && (
          <div className="sftp-file-header">
            <span className="sftp-file-header-icon" />
            <span className="sftp-file-header-name">{t('sftp_col_name')}</span>
            <span className="sftp-file-header-size">{t('sftp_col_size')}</span>
            <span className="sftp-file-header-perm">{t('sftp_col_perm')}</span>
          </div>
        )}

        {newFolderMode && (
          <div className="sftp-file-item sftp-new-folder-item">
            <SftpEntryIcon kind="folder" name={newFolderName || 'folder'} />
            <input
              className="sftp-rename-input"
              value={newFolderName}
              onChange={(e) => onNewFolderNameChange(e.target.value)}
              onBlur={onCommitNewFolder}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommitNewFolder();
                if (e.key === 'Escape') onCancelNewFolder();
              }}
              placeholder={t('sftp_folder_name')}
              autoFocus
            />
          </div>
        )}

        {newFileMode && (
          <div className="sftp-file-item sftp-new-folder-item">
            <SftpEntryIcon kind="file" name={newFileName || 'file'} />
            <input
              className="sftp-rename-input"
              value={newFileName}
              onChange={(e) => onNewFileNameChange(e.target.value)}
              onBlur={onCommitNewFile}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommitNewFile();
                if (e.key === 'Escape') onCancelNewFile();
              }}
              placeholder={t('sftp_file_name')}
              autoFocus
            />
          </div>
        )}

        {currentPath !== '/' && (
          <div
            className={`sftp-file-item sftp-file-dir sftp-file-parent${parentSelected && !selectedEntry ? ' sftp-file-item-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-label=".."
            onMouseDown={recordPointerDown}
            onClick={(e) => {
              if (!isStationaryClick(e)) return;
              recordRowClick(PARENT_ROW_KEY, e);
              onEntryClick(null);
              setParentSelected(true);
            }}
            onDoubleClick={(e) => {
              if (!canActivateRow(PARENT_ROW_KEY, e)) return;
              onGoUp();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!loading) onGoUp();
              }
            }}
          >
            <SftpEntryIcon kind="parent" name=".." />
            <span className="sftp-file-name">..</span>
            <span className="sftp-file-size">-</span>
            <span className="sftp-file-perm" />
          </div>
        )}

        <div className="sftp-virtual-list" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
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
                onMouseDown={recordPointerDown}
                onClick={(e) => {
                  if (!isStationaryClick(e)) return;
                  recordRowClick(entry.path, e);
                  setParentSelected(false);
                  onEntryClick(entry);
                }}
                onDoubleClick={(e) => {
                  if (!canActivateRow(entry.path, e)) return;
                  setParentSelected(false);
                  onEntryDoubleClick(entry);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!loading && renamingEntry === null) {
                      onEntryDoubleClick(entry);
                    }
                  }
                }}
                onContextMenu={(e) => onContextMenu(e, entry)}
              >
                <SftpEntryIcon
                  kind={entry.is_dir ? 'folder' : 'file'}
                  name={renamingEntry === entry.path ? renameValue || entry.name : entry.name}
                />
                {renamingEntry === entry.path ? (
                  <input
                    className="sftp-rename-input"
                    value={renameValue}
                    onChange={(e) => onRenameValueChange(e.target.value)}
                    onBlur={() => onCommitRename(entry)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onCommitRename(entry);
                      if (e.key === 'Escape') onCancelRename();
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span className="sftp-file-name" title={entry.name}>
                      {entry.name}
                    </span>
                    <span className="sftp-file-size">
                      {entry.is_dir ? '' : formatSize(entry.size)}
                    </span>
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

      {progress && (
        <div className="sftp-progress">
          <div className="sftp-progress-info">
            <span className="sftp-progress-name" title={progress.file}>
              {(progress.kind === 'upload' ? '↑ ' : '↓ ') +
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                (progress.file.split('/').pop() || progress.file)}
            </span>
            {progress.fileTotal > 1 && (
              <span className="sftp-progress-count">
                {progress.fileIndex}/{progress.fileTotal}
              </span>
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
              style={{
                width: `${progress.total > 0 ? Math.min(100, (progress.bytes / progress.total) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      <div className="sftp-status">{t('sftp_item_count', { count: entries.length })}</div>
    </>
  );
};
