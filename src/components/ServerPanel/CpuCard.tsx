import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CpuStats } from '../../types/serverMetrics';

interface Props {
  cpu: CpuStats | null;
}

function fmt(n: number): string {
  return `${n.toFixed(1)}%`;
}

export const CpuCard: React.FC<Props> = ({ cpu }) => {
  const { t } = useTranslation();

  if (!cpu) {
    return (
      <div className="sp-card sp-card--cpu">
        <div className="sp-card__title">{t('serverPanel_cpu_title')}</div>
        <div className="sp-empty">—</div>
      </div>
    );
  }

  return (
    <div className="sp-card sp-card--cpu">
      <div className="sp-grid-4">
        <div className="sp-stat">
          <span className="sp-stat__label">{t('serverPanel_cpu_avg')}</span>
          <span className="sp-stat__value">{fmt(cpu.total_percent)}</span>
        </div>
        <div className="sp-stat">
          <span className="sp-stat__label">{t('serverPanel_cpu_user')}</span>
          <span className="sp-stat__value">{fmt(cpu.user_percent)}</span>
        </div>
        <div className="sp-stat">
          <span className="sp-stat__label">{t('serverPanel_cpu_system')}</span>
          <span className="sp-stat__value">{fmt(cpu.system_percent)}</span>
        </div>
        <div className="sp-stat">
          <span className="sp-stat__label">{t('serverPanel_cpu_iowait')}</span>
          <span className="sp-stat__value">{fmt(cpu.iowait_percent)}</span>
        </div>
      </div>
      <div className="sp-corelist">
        {cpu.per_core.map((p, i) => (
          <div key={`core-${i}`} className="sp-corerow">
            <span className="sp-corerow__name">CPU{i + 1}</span>
            <span className="sp-corerow__bar">
              <span
                className="sp-corerow__bar-fill"
                style={{ width: `${Math.min(100, Math.max(0, p))}%` }}
              />
            </span>
            <span className="sp-corerow__pct">{fmt(p)}</span>
          </div>
        ))}
      </div>
      <div className="sp-loadavg">
        <span>{t('serverPanel_cpu_load')}:</span>
        <span>{cpu.loadavg_1m.toFixed(2)}</span>
        <span>{cpu.loadavg_5m.toFixed(2)}</span>
        <span>{cpu.loadavg_15m.toFixed(2)}</span>
      </div>
    </div>
  );
};
