import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Cpu, HardDrive, MemoryStick, Network } from 'lucide-react';
import type { CpuStats, DiskStats, HostInfo, MemStats, NetStats } from '../../types/serverMetrics';
import { fmtBytes, fmtRate, usageLevel } from './format';

interface Props {
  host: HostInfo | null;
  cpu: CpuStats | null;
  mem: MemStats | null;
  disk: DiskStats | null;
  net: NetStats | null;
}

const RING_SIZE = 44;
const STROKE = 4.5;
const RADIUS = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const MiniGaugeRing: React.FC<{ pct: number | null; tone: 'ok' | 'warn' | 'danger' }> = ({
  pct,
  tone,
}) => {
  const safe = pct === null ? 0 : Math.min(100, Math.max(0, pct));
  const offset = CIRCUMFERENCE * (1 - safe / 100);
  return (
    <div className={`sp-ring is-${tone}`}>
      <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
        <circle
          className="sp-ring__track"
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          fill="none"
        />
        <circle
          className="sp-ring__fill"
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          fill="none"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </svg>
      <span className="sp-ring__val">{pct === null ? '—' : `${Math.round(safe)}%`}</span>
    </div>
  );
};

export const MetricRingGrid: React.FC<Props> = ({ host, cpu, mem, disk, net }) => {
  const { t } = useTranslation();

  const cpuPct = cpu ? cpu.total_percent : null;
  const memPct =
    mem && mem.mem_total_bytes > 0 ? (mem.mem_used_bytes / mem.mem_total_bytes) * 100 : null;
  const diskPct = disk && disk.total_bytes > 0 ? (disk.used_bytes / disk.total_bytes) * 100 : null;

  return (
    <div className="sp-kpi-grid">
      <div className="sp-kpi-card">
        <MiniGaugeRing pct={cpuPct} tone={cpuPct !== null ? usageLevel(cpuPct) : 'ok'} />
        <div className="sp-kpi-meta">
          <div className="sp-kpi-head">
            <Cpu size={11} />
            <span>{t('serverPanel_cpu_title')}</span>
          </div>
          <div className="sp-kpi-primary">{cpuPct !== null ? `${cpuPct.toFixed(1)}%` : '—'}</div>
          <div className="sp-kpi-sub">
            {host
              ? t('serverPanel_cores_unit', { count: host.cpu_cores })
              : cpu && cpu.loadavg_1m > 0
                ? `${t('serverPanel_cpu_load')} ${cpu.loadavg_1m.toFixed(2)}`
                : '—'}
          </div>
        </div>
      </div>

      <div className="sp-kpi-card">
        <MiniGaugeRing pct={memPct} tone={memPct !== null ? usageLevel(memPct) : 'ok'} />
        <div className="sp-kpi-meta">
          <div className="sp-kpi-head">
            <MemoryStick size={11} />
            <span>{t('serverPanel_mem_title')}</span>
          </div>
          <div className="sp-kpi-primary">{mem ? fmtBytes(mem.mem_used_bytes) : '—'}</div>
          <div className="sp-kpi-sub">{mem ? `/ ${fmtBytes(mem.mem_total_bytes)}` : '—'}</div>
        </div>
      </div>

      <div className="sp-kpi-card">
        <MiniGaugeRing pct={diskPct} tone={diskPct !== null ? usageLevel(diskPct) : 'ok'} />
        <div className="sp-kpi-meta">
          <div className="sp-kpi-head">
            <HardDrive size={11} />
            <span>{t('serverPanel_disk_title')}</span>
            {disk?.mount && <code className="sp-kpi-mount">{disk.mount}</code>}
          </div>
          <div className="sp-kpi-primary">{disk ? fmtBytes(disk.used_bytes) : '—'}</div>
          <div className="sp-kpi-sub">{disk ? `/ ${fmtBytes(disk.total_bytes)}` : '—'}</div>
        </div>
      </div>

      <div className="sp-kpi-card sp-kpi-card--net">
        <div className="sp-kpi-net-icon">
          <Network size={16} />
        </div>
        <div className="sp-kpi-meta">
          <div className="sp-kpi-head">
            <span>{t('serverPanel_net_title')}</span>
          </div>
          <div className="sp-kpi-net-rates">
            <span className="sp-rate-rx">
              <ArrowDown size={11} />
              {net ? fmtRate(net.rx_bytes_per_sec) : '—'}
            </span>
            <span className="sp-rate-tx">
              <ArrowUp size={11} />
              {net ? fmtRate(net.tx_bytes_per_sec) : '—'}
            </span>
          </div>
          <div className="sp-kpi-sub">
            {net ? `${fmtBytes(net.total_rx_bytes + net.total_tx_bytes)}` : '—'}
          </div>
        </div>
      </div>
    </div>
  );
};
