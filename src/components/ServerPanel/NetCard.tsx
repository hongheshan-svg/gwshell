import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, ArrowDown, ArrowUp } from 'lucide-react';
import type { NetStats } from '../../types/serverMetrics';
import { Sparkline, type SparkSeries } from './Sparkline';
import { fmtBytes, fmtRate } from './format';

interface Props {
  net: NetStats | null;
  rxHistory: number[];
  txHistory: number[];
}

export const NetCard: React.FC<Props> = ({ net, rxHistory, txHistory }) => {
  const { t } = useTranslation();

  const series: SparkSeries[] = useMemo(
    () => [
      { label: t('serverPanel_net_legend_rx'), color: '#10b981', data: rxHistory },
      { label: t('serverPanel_net_legend_tx'), color: '#f59e0b', data: txHistory },
    ],
    [t, rxHistory, txHistory],
  );

  const peakRate = useMemo(() => {
    let m = 0;
    for (const v of rxHistory) if (v > m) m = v;
    for (const v of txHistory) if (v > m) m = v;
    return m;
  }, [rxHistory, txHistory]);

  return (
    <div className="sp-card">
      <div className="sp-card__header">
        <div className="sp-card__title">
          <span className="sp-card__icon sp-card__icon--net">
            <Activity size={12} />
          </span>
          <span>{t('serverPanel_chart_net')}</span>
        </div>
        {peakRate > 0 && (
          <span className="sp-chart-peak">
            {t('serverPanel_chart_peak', { rate: fmtRate(peakRate) })}
          </span>
        )}
      </div>

      <div className="sp-net-tiles">
        <div className="sp-net-tile is-rx">
          <div className="sp-net-tile__head">
            <ArrowDown size={12} />
            <span>{t('serverPanel_net_rate_rx')}</span>
          </div>
          <div className="sp-net-tile__val">{net ? fmtRate(net.rx_bytes_per_sec) : '—'}</div>
          <div className="sp-net-tile__sub">
            {t('serverPanel_net_total_rx')}: {net ? fmtBytes(net.total_rx_bytes) : '—'}
          </div>
        </div>
        <div className="sp-net-tile is-tx">
          <div className="sp-net-tile__head">
            <ArrowUp size={12} />
            <span>{t('serverPanel_net_rate_tx')}</span>
          </div>
          <div className="sp-net-tile__val">{net ? fmtRate(net.tx_bytes_per_sec) : '—'}</div>
          <div className="sp-net-tile__sub">
            {t('serverPanel_net_total_tx')}: {net ? fmtBytes(net.total_tx_bytes) : '—'}
          </div>
        </div>
      </div>

      <div className="sp-chart-wrap">
        <Sparkline series={series} width={360} height={96} className="sp-sparkline" />
      </div>
    </div>
  );
};
