import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SftpEntry } from '../../lib/sftpUtils';

interface SftpChmodDialogProps {
  entry: SftpEntry;
  value: string;
  onChange: (val: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export const SftpChmodDialog: React.FC<SftpChmodDialogProps> = ({
  entry,
  value,
  onChange,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className="sftp-chmod-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="sftp-chmod-dialog">
        <div className="sftp-chmod-title">{t('sftp_chmod')}</div>
        <div className="sftp-chmod-filename">{entry.name}</div>
        <div className="sftp-chmod-row">
          <label>{t('sftp_chmod_label')}</label>
          <input
            className="sftp-chmod-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirm();
              if (e.key === 'Escape') onCancel();
            }}
            placeholder="755"
            maxLength={4}
            autoFocus
          />
        </div>
        <div className="sftp-chmod-actions">
          <button type="button" className="sftp-chmod-btn sftp-chmod-cancel" onClick={onCancel}>
            {t('sftp_cancel')}
          </button>
          <button type="button" className="sftp-chmod-btn sftp-chmod-ok" onClick={onConfirm}>
            {t('sftp_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
