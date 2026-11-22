import React from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive } from 'lucide-react';
import type { DiskStats } from '../../types/serverMetrics';
import { fmtBytes, usageLevel } from './format';

interface Props {
  disk: DiskStats | null;
}

export const DiskCard: React.FC<Props> = ({ disk }) => {
  const { t } = useTranslation();

  if (!disk) {
    return (
      <div className="sp-card">
        <div className="sp-card__header">
          <div className="sp-card__title">
            <span className="sp-card__icon sp-card__icon--disk">
              <HardDrive size={12} />
            </span>
            <span>{t('serverPanel_disk_title')}</span>
          </div>
        </div>
        <div className="sp-empty">—</div>
      </div>
    );
  }

  const pct =
    disk.total_bytes > 0
      ? Math.min(100, Math.max(0, (disk.used_bytes / disk.total_bytes) * 100))
      : 0;
  const freeBytes = Math.max(0, disk.total_bytes - disk.used_bytes);
  const mount = disk.mount && disk.mount.length > 0 ? disk.mount : '/';

  return (
    <div className="sp-card">
      <div className="sp-card__header">
        <div className="sp-card__title">
          <span className="sp-card__icon sp-card__icon--disk">
            <HardDrive size={12} />
          </span>
          <span>{t('serverPanel_disk_title')}</span>
          <code className="sp-mount-pill">{mount}</code>
        </div>
        <span className={`sp-pct-badge is-${usageLevel(pct)}`}>{pct.toFixed(1)}%</span>
      </div>

      <div className="sp-bar-group">
        <div className="sp-bar-track">
          <div className={`sp-bar-fill is-${usageLevel(pct)}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="sp-disk-stats">
        <div className="sp-disk-kv">
          <span>{t('serverPanel_disk_used_pct')}</span>
          <strong>{fmtBytes(disk.used_bytes)}</strong>
        </div>
        <div className="sp-disk-kv">
          <span>{t('serverPanel_disk_free')}</span>
          <strong>{fmtBytes(freeBytes)}</strong>
        </div>
        <div className="sp-disk-kv">
          <span>Total</span>
          <strong>{fmtBytes(disk.total_bytes)}</strong>
        </div>
      </div>
    </div>
  );
};
