import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { SftpEntryIcon } from './SftpEntryIcon';
import {
  formatPermissions,
  formatSize,
  type SftpEntry,
  type SftpProgress,
} from '../../lib/sftpUtils';

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
  onEntryClick: (entry: SftpEntry) => void;
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
            className="sftp-file-item sftp-file-dir sftp-file-parent"
            role="button"
            tabIndex={0}
            aria-label=".."
            onClick={onGoUp}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onGoUp();
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
                onClick={() => onEntryClick(entry)}
                onDoubleClick={() => onEntryDoubleClick(entry)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onEntryDoubleClick(entry);
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
