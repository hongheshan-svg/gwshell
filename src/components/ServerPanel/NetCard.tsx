import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { NetStats } from '../../types/serverMetrics';
import { Sparkline, type SparkSeries } from './Sparkline';

interface Props {
  net: NetStats | null;
  cpuHistory: number[];
  memHistory: number[];
  rxHistory: number[];
  txHistory: number[];
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

function fmtRate(bps: number): string {
  return `${fmtBytes(bps)}/s`;
}

export const NetCard: React.FC<Props> = ({ net, cpuHistory, memHistory, rxHistory, txHistory }) => {
  const { t } = useTranslation();

  // Stabilize the series array reference so Sparkline (and its internal
  // path memo) don't recompute on every parent render — the metrics panel
  // refreshes frequently and the array was rebuilt each frame.
  const series: SparkSeries[] = useMemo(() => [
    { label: t('serverPanel_net_legend_cpu'), color: '#3b82f6', data: cpuHistory },
    { label: t('serverPanel_net_legend_mem'), color: '#22c55e', data: memHistory },
    { label: t('serverPanel_net_legend_tx'), color: '#f59e0b', data: txHistory },
    { label: t('serverPanel_net_legend_rx'), color: '#10b981', data: rxHistory },
  ], [t, cpuHistory, memHistory, rxHistory, txHistory]);

  return (
    <div className="sp-card sp-card--net">
      <div className="sp-grid-2">
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_net_total_tx')}</span>
          <span className="sp-kv__v">{net ? fmtBytes(net.total_tx_bytes) : '—'}</span>
        </div>
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_net_total_rx')}</span>
          <span className="sp-kv__v">{net ? fmtBytes(net.total_rx_bytes) : '—'}</span>
        </div>
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_net_rate_tx')}</span>
          <span className="sp-kv__v">{net ? fmtRate(net.tx_bytes_per_sec) : '—'}</span>
        </div>
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_net_rate_rx')}</span>
          <span className="sp-kv__v">{net ? fmtRate(net.rx_bytes_per_sec) : '—'}</span>
        </div>
      </div>
      <div className="sp-legend">
        {series.map((s) => (
          <span key={s.label} className="sp-legend__item">
            <span className="sp-legend__dot" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <Sparkline series={series} width={340} height={80} className="sp-sparkline" />
    </div>
  );
};
