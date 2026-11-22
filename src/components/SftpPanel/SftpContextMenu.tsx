import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Copy,
  Download,
  Edit3,
  ExternalLink,
  FileEdit,
  FilePlus,
  FolderPlus,
  FolderUp,
  RefreshCw,
  Shield,
  Trash2,
  Upload,
} from 'lucide-react';
import type { SftpEntry } from '../../lib/sftpUtils';

interface SftpContextMenuProps {
  x: number;
  y: number;
  entry: SftpEntry | null;
  currentPath: string;
  onClose: () => void;
  onEditOnline: (entry: SftpEntry) => void;
  onOpenLocal: (entry: SftpEntry) => void;
  onDownload: (entry: SftpEntry) => void;
  onUpload: () => void;
  onUploadFolder: () => void;
  onRefresh: () => void;
  onCopyPath: (path: string) => void;
  onStartRename: (entry: SftpEntry) => void;
  onStartChmod: (entry: SftpEntry) => void;
  onDelete: (entry: SftpEntry) => void;
  onStartNewFolder: () => void;
  onStartNewFile: () => void;
}

export const SftpContextMenu: React.FC<SftpContextMenuProps> = ({
  x,
  y,
  entry,
  currentPath,
  onClose,
  onEditOnline,
  onOpenLocal,
  onDownload,
  onUpload,
  onUploadFolder,
  onRefresh,
  onCopyPath,
  onStartRename,
  onStartChmod,
  onDelete,
  onStartNewFolder,
  onStartNewFile,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className="sftp-context-menu"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 200)),
        top: Math.max(8, Math.min(y, window.innerHeight - 320)),
      }}
    >
      {entry ? (
        <>
          {!entry.is_dir && (
            <>
              <div
                className="sftp-context-item"
                onClick={() => {
                  onEditOnline(entry);
                  onClose();
                }}
              >
                <FileEdit size={13} />
                <span>{t('sftp_edit_online')}</span>
              </div>
              <div
                className="sftp-context-item"
                onClick={() => {
                  onOpenLocal(entry);
                  onClose();
                }}
              >
                <ExternalLink size={13} />
                <span>{t('sftp_open_local')}</span>
              </div>
            </>
          )}
          <div
            className="sftp-context-item"
            onClick={() => {
              onDownload(entry);
              onClose();
            }}
          >
            <Download size={13} />
            <span>{t('sftp_download_to')}</span>
          </div>
          <div
            className="sftp-context-item"
            onClick={() => {
              onUpload();
              onClose();
            }}
          >
            <Upload size={13} />
            <span>{t('sftp_upload_file')}</span>
          </div>
          <div
            className="sftp-context-item"
            onClick={() => {
              onUploadFolder();
              onClose();
            }}
          >
            <FolderUp size={13} />
            <span>{t('sftp_upload_folder')}</span>
          </div>
          <div className="sftp-context-divider" />
          <div
            className="sftp-context-item"
            onClick={() => {
              onRefresh();
              onClose();
            }}
          >
            <RefreshCw size={13} />
            <span>{t('sftp_refresh')}</span>
          </div>
          <div className="sftp-context-divider" />
          <div
            className="sftp-context-item"
            onClick={() => {
              onCopyPath(entry.path);
              onClose();
            }}
          >
            <Copy size={13} />
            <span>{t('sftp_copy_path')}</span>
          </div>
          <div
            className="sftp-context-item"
            onClick={() => {
              onStartRename(entry);
              onClose();
            }}
          >
            <Edit3 size={13} />
            <span>{t('sftp_rename')}</span>
          </div>
          <div
            className="sftp-context-item"
            onClick={() => {
              onStartChmod(entry);
              onClose();
            }}
          >
            <Shield size={13} />
            <span>{t('sftp_chmod')}</span>
          </div>
          <div className="sftp-context-divider" />
          <div
            className="sftp-context-item sftp-context-danger"
            onClick={() => {
              onDelete(entry);
              onClose();
            }}
          >
            <Trash2 size={13} />
            <span>{t('sftp_delete')}</span>
          </div>
        </>
      ) : (
        <>
          <div
            className="sftp-context-item"
            onClick={() => {
              onRefresh();
              onClose();
            }}
          >
            <RefreshCw size={13} />
            <span>{t('sftp_refresh')}</span>
          </div>
          <div className="sftp-context-divider" />
          <div
            className="sftp-context-item"
            onClick={() => {
              onCopyPath(currentPath);
              onClose();
            }}
          >
            <Copy size={13} />
            <span>{t('sftp_copy_path')}</span>
          </div>
          <div
            className="sftp-context-item"
            onClick={() => {
              onStartNewFolder();
              onClose();
            }}
          >
            <FolderPlus size={13} />
            <span>{t('sftp_new_folder')}</span>
          </div>
          <div
            className="sftp-context-item"
            onClick={() => {
              onStartNewFile();
              onClose();
            }}
          >
            <FilePlus size={13} />
            <span>{t('sftp_new_file')}</span>
          </div>
          <div className="sftp-context-divider" />
          <div
            className="sftp-context-item"
            onClick={() => {
              onUpload();
              onClose();
            }}
          >
            <Upload size={13} />
            <span>{t('sftp_upload_file')}</span>
          </div>
          <div
            className="sftp-context-item"
            onClick={() => {
              onUploadFolder();
              onClose();
            }}
          >
            <FolderUp size={13} />
            <span>{t('sftp_upload_folder')}</span>
          </div>
        </>
      )}
    </div>
  );
};
