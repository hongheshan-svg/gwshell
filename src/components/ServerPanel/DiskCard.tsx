import React from 'react';
import { useTranslation } from 'react-i18next';
import type { DiskStats } from '../../types/serverMetrics';

interface Props {
  disk: DiskStats | null;
}

function fmtBytes(bytes: number): string {
  if (!bytes) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)}${units[u]}`;
}

function bar(used: number, total: number): { pct: number; label: string } {
  if (total <= 0) return { pct: 0, label: '—' };
  const pct = Math.min(100, Math.max(0, (used / total) * 100));
  return { pct, label: `${fmtBytes(used)}/${fmtBytes(total)}` };
}

export const DiskCard: React.FC<Props> = ({ disk }) => {
  const { t } = useTranslation();

  if (!disk) {
    return (
      <div className="sp-card sp-card--disk">
        <div className="sp-card__title">{t('serverPanel_disk_title')}</div>
        <div className="sp-empty">—</div>
      </div>
    );
  }

  const d = bar(disk.used_bytes, disk.total_bytes);

  return (
    <div className="sp-card sp-card--disk">
      <div className="sp-membar">
        <div className="sp-membar__head">
          <span>{disk.mount || '/'}</span>
          <span>{d.label}</span>
        </div>
        <div className="sp-membar__track">
          <div className="sp-membar__fill sp-membar__fill--disk" style={{ width: `${d.pct}%` }} />
        </div>
      </div>
      <div className="sp-kv" style={{ marginTop: '6px' }}>
        <span className="sp-kv__k">{t('serverPanel_disk_used_pct')}</span>
        <span className="sp-kv__v">{d.pct.toFixed(1)}%</span>
      </div>
    </div>
  );
};
