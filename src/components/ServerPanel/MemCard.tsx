import React from 'react';
import { useTranslation } from 'react-i18next';
import { MemoryStick } from 'lucide-react';
import type { MemStats } from '../../types/serverMetrics';
import { fmtBytes, usageLevel } from './format';

interface Props {
  mem: MemStats | null;
}

function calcBar(used: number, total: number): { pct: number; label: string } {
  if (total <= 0) return { pct: 0, label: '—' };
  const pct = Math.min(100, Math.max(0, (used / total) * 100));
  return { pct, label: `${fmtBytes(used)} / ${fmtBytes(total)}` };
}

export const MemCard: React.FC<Props> = ({ mem }) => {
  const { t } = useTranslation();

  if (!mem) {
    return (
      <div className="sp-card">
        <div className="sp-card__header">
          <div className="sp-card__title">
            <span className="sp-card__icon sp-card__icon--mem">
              <MemoryStick size={12} />
            </span>
            <span>{t('serverPanel_mem_title')}</span>
          </div>
        </div>
        <div className="sp-empty">—</div>
      </div>
    );
  }

  const ram = calcBar(mem.mem_used_bytes, mem.mem_total_bytes);
  const swap = calcBar(mem.swap_used_bytes, mem.swap_total_bytes);

  return (
    <div className="sp-card">
      <div className="sp-card__header">
        <div className="sp-card__title">
          <span className="sp-card__icon sp-card__icon--mem">
            <MemoryStick size={12} />
          </span>
          <span>{t('serverPanel_mem_title')}</span>
        </div>
        <span className={`sp-pct-badge is-${usageLevel(ram.pct)}`}>{ram.pct.toFixed(1)}%</span>
      </div>

      <div className="sp-bar-group">
        <div className="sp-bar-row">
          <span className="sp-bar-label">{t('serverPanel_mem_physical')}</span>
          <span className="sp-bar-val">{ram.label}</span>
        </div>
        <div className="sp-bar-track">
          <div
            className={`sp-bar-fill is-${usageLevel(ram.pct)}`}
            style={{ width: `${ram.pct}%` }}
          />
        </div>
      </div>

      <div className="sp-bar-group">
        <div className="sp-bar-row">
          <span className="sp-bar-label">{t('serverPanel_mem_swap')}</span>
          <span className="sp-bar-val">
            {mem.swap_total_bytes > 0 ? `${swap.label} (${swap.pct.toFixed(0)}%)` : '—'}
          </span>
        </div>
        <div className="sp-bar-track">
          <div className="sp-bar-fill is-swap" style={{ width: `${swap.pct}%` }} />
        </div>
      </div>
    </div>
  );
};
