import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MemStats } from '../../types/serverMetrics';

interface Props {
  mem: MemStats | null;
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

export const MemCard: React.FC<Props> = ({ mem }) => {
  const { t } = useTranslation();

  if (!mem) {
    return (
      <div className="sp-card sp-card--mem">
        <div className="sp-card__title">{t('serverPanel_mem_title')}</div>
        <div className="sp-empty">—</div>
      </div>
    );
  }

  const ram = bar(mem.mem_used_bytes, mem.mem_total_bytes);
  const swap = bar(mem.swap_used_bytes, mem.swap_total_bytes);

  return (
    <div className="sp-card sp-card--mem">
      <div className="sp-membar">
        <div className="sp-membar__head">
          <span>{t('serverPanel_mem_physical')}</span>
          <span>{ram.label}</span>
        </div>
        <div className="sp-membar__track">
          <div className="sp-membar__fill sp-membar__fill--ram" style={{ width: `${ram.pct}%` }} />
        </div>
      </div>
      <div className="sp-membar">
        <div className="sp-membar__head">
          <span>{t('serverPanel_mem_swap')}</span>
          <span>{swap.label}</span>
        </div>
        <div className="sp-membar__track">
          <div className="sp-membar__fill sp-membar__fill--swap" style={{ width: `${swap.pct}%` }} />
        </div>
      </div>
    </div>
  );
};
