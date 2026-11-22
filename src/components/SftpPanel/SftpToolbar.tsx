import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, Download, FolderPlus, Home, RefreshCw, Trash2, Upload, X } from 'lucide-react';

interface SftpToolbarProps {
  currentPath: string;
  editingPath: boolean;
  pathInput: string;
  fileCount: number;
  folderCount: number;
  error: string | null;
  busy: boolean;
  hasSelection: boolean;
  onClosePanel: () => void;
  onGoHome: () => void;
  onGoUp: () => void;
  onRefresh: () => void;
  onStartNewFolder: () => void;
  onUpload: () => void;
  onDownloadSelected: () => void;
  onDeleteSelected: () => void;
  onStartEditPath: () => void;
  onPathInputChange: (val: string) => void;
  onPathSubmit: () => void;
  onCancelEditPath: () => void;
  onDismissError: () => void;
}

export const SftpToolbar: React.FC<SftpToolbarProps> = ({
  currentPath,
  editingPath,
  pathInput,
  fileCount,
  folderCount,
  error,
  busy,
  hasSelection,
  onClosePanel,
  onGoHome,
  onGoUp,
  onRefresh,
  onStartNewFolder,
  onUpload,
  onDownloadSelected,
  onDeleteSelected,
  onStartEditPath,
  onPathInputChange,
  onPathSubmit,
  onCancelEditPath,
  onDismissError,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <div className="sftp-header">
        <span className="sftp-title">{t('sftp_title')}</span>
        <button className="sftp-header-btn" onClick={onClosePanel} title={t('sftp_close')}>
          <X size={14} />
        </button>
      </div>

      <div className="sftp-toolbar">
        <button className="sftp-tool-btn" onClick={onGoHome} title={t('sftp_home')}>
          <Home size={14} />
        </button>
        <button className="sftp-tool-btn" onClick={onGoUp} title={t('sftp_parent')}>
          <ChevronUp size={14} />
        </button>
        <button className="sftp-tool-btn" onClick={onRefresh} title={t('sftp_refresh')}>
          <RefreshCw size={14} />
        </button>
        <div className="sftp-toolbar-sep" />
        <button className="sftp-tool-btn" onClick={onStartNewFolder} title={t('sftp_new_folder')}>
          <FolderPlus size={14} />
        </button>
        <button
          className="sftp-tool-btn"
          onClick={onUpload}
          disabled={busy}
          title={t('sftp_upload')}
        >
          <Upload size={14} />
        </button>
        <div className="sftp-toolbar-sep" />
        <button
          className="sftp-tool-btn"
          onClick={onDownloadSelected}
          disabled={!hasSelection || busy}
          title={t('sftp_download')}
        >
          <Download size={14} />
        </button>
        <button
          className="sftp-tool-btn sftp-tool-btn-danger"
          onClick={onDeleteSelected}
          disabled={!hasSelection || busy}
          title={t('sftp_delete')}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="sftp-pathbar">
        {editingPath ? (
          <input
            className="sftp-path-input"
            value={pathInput}
            onChange={(e) => onPathInputChange(e.target.value)}
            onBlur={onPathSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onPathSubmit();
              if (e.key === 'Escape') onCancelEditPath();
            }}
            autoFocus
          />
        ) : (
          <div className="sftp-path-display" onClick={onStartEditPath} title={currentPath}>
            {currentPath}
          </div>
        )}
      </div>

      <div className="sftp-infobar">
        {t('sftp_info', { files: fileCount, folders: folderCount })}
      </div>

      {error && (
        <div className="sftp-error">
          {error}
          <button className="sftp-error-close" onClick={onDismissError}>
            <X size={12} />
          </button>
        </div>
      )}
    </>
  );
};
