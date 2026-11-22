import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Cpu } from 'lucide-react';
import type { CpuStats } from '../../types/serverMetrics';
import { usageLevel } from './format';

interface Props {
  cpu: CpuStats | null;
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export const CpuCard: React.FC<Props> = ({ cpu }) => {
  const { t } = useTranslation();
  const [coresExpanded, setCoresExpanded] = useState(true);

  if (!cpu) {
    return (
      <div className="sp-card">
        <div className="sp-card__header">
          <div className="sp-card__title">
            <span className="sp-card__icon sp-card__icon--cpu">
              <Cpu size={12} />
            </span>
            <span>{t('serverPanel_cpu_title')}</span>
          </div>
        </div>
        <div className="sp-empty">—</div>
      </div>
    );
  }

  const userW = Math.min(100, Math.max(0, cpu.user_percent));
  const sysW = Math.min(100 - userW, Math.max(0, cpu.system_percent));
  const ioW = Math.min(100 - userW - sysW, Math.max(0, cpu.iowait_percent));
  const idlePct = Math.max(0, 100 - cpu.total_percent);
  const hasLoad = cpu.loadavg_1m > 0 || cpu.loadavg_5m > 0 || cpu.loadavg_15m > 0;
  const compactHeatmap = cpu.per_core.length > 8;

  return (
    <div className="sp-card">
      <div className="sp-card__header">
        <div className="sp-card__title">
          <span className="sp-card__icon sp-card__icon--cpu">
            <Cpu size={12} />
          </span>
          <span>{t('serverPanel_cpu_title')}</span>
        </div>
        {hasLoad && (
          <div className="sp-load-pills" title={t('serverPanel_cpu_load')}>
            <span className="sp-load-label">{t('serverPanel_cpu_load')}</span>
            <code>{cpu.loadavg_1m.toFixed(2)}</code>
            <code>{cpu.loadavg_5m.toFixed(2)}</code>
            <code>{cpu.loadavg_15m.toFixed(2)}</code>
          </div>
        )}
      </div>

      {/* Stacked User / System / IO Wait bar */}
      <div className="sp-stacked-track">
        <div className="sp-stacked-seg is-user" style={{ width: `${userW}%` }} />
        <div className="sp-stacked-seg is-sys" style={{ width: `${sysW}%` }} />
        <div className="sp-stacked-seg is-io" style={{ width: `${ioW}%` }} />
      </div>

      <div className="sp-breakdown-row">
        <span className="sp-breakdown-item">
          <i className="sp-dot is-user" />
          <span>{t('serverPanel_cpu_user')}</span>
          <strong>{fmtPct(cpu.user_percent)}</strong>
        </span>
        <span className="sp-breakdown-item">
          <i className="sp-dot is-sys" />
          <span>{t('serverPanel_cpu_system')}</span>
          <strong>{fmtPct(cpu.system_percent)}</strong>
        </span>
        <span className="sp-breakdown-item">
          <i className="sp-dot is-io" />
          <span>{t('serverPanel_cpu_iowait')}</span>
          <strong>{fmtPct(cpu.iowait_percent)}</strong>
        </span>
        <span className="sp-breakdown-item">
          <i className="sp-dot is-idle" />
          <span>{t('serverPanel_cpu_idle')}</span>
          <strong>{fmtPct(idlePct)}</strong>
        </span>
      </div>

      {cpu.per_core.length > 0 && (
        <div className="sp-cores-section">
          <button
            type="button"
            className="sp-cores-toggle"
            onClick={() => setCoresExpanded((v) => !v)}
          >
            {coresExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>{t('serverPanel_cores_toggle', { count: cpu.per_core.length })}</span>
          </button>
          {coresExpanded &&
            (compactHeatmap ? (
              <div className="sp-core-heatmap">
                {cpu.per_core.map((p, i) => (
                  <div
                    key={`core-${i}`}
                    className={`sp-core-tile is-${usageLevel(p)}`}
                    title={`CPU ${i + 1}: ${fmtPct(p)}`}
                  >
                    <span className="sp-core-tile__id">C{i}</span>
                    <span className="sp-core-tile__val">{Math.round(p)}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sp-core-grid">
                {cpu.per_core.map((p, i) => (
                  <div key={`core-${i}`} className="sp-corerow">
                    <span className="sp-corerow__name">C{i}</span>
                    <span className="sp-corerow__bar">
                      <span
                        className={`sp-corerow__bar-fill is-${usageLevel(p)}`}
                        style={{ width: `${Math.min(100, Math.max(0, p))}%` }}
                      />
                    </span>
                    <span className="sp-corerow__pct">{Math.round(p)}%</span>
                  </div>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
