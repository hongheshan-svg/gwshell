import React, { useMemo } from 'react';
import { Play, Pencil, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SessionConfig } from '../../types';
import type { MetricsSnapshot } from '../../types/serverMetrics';
import { OsDistroIcon, ProtocolIcon } from '../Icons/BrandIcons';
import { shortOsLabel } from '../../lib/osDistro';
import './AssetDashboard.css';

interface Props {
  session: SessionConfig;
  connected: boolean;
  snapshot?: MetricsSnapshot | null;
  cpuHistory?: number[];
  latency?: number | null;
  onConnect: (s: SessionConfig) => void;
  onEdit: (s: SessionConfig) => void;
  onFocus?: (s: SessionConfig) => void;
  onContextMenu?: (e: React.MouseEvent, s: SessionConfig) => void;
}

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return (n / 1_073_741_824).toFixed(1) + 'G';
  if (n >= 1_048_576) return (n / 1_048_576).toFixed(1) + 'M';
  if (n >= 1_024) return (n / 1_024).toFixed(1) + 'K';
  return n + 'B';
}

function pct(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

function cpuColor(p: number): string {
  if (p > 90) return 'var(--danger)';
  if (p > 70) return 'var(--warning)';
  return 'var(--accent-primary)';
}

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
}

const Sparkline: React.FC<SparklineProps> = ({ values, width = 84, height = 22 }) => {
  const points = useMemo(() => {
    if (values.length === 0) {
      return `0,${height} ${width},${height}`;
    }
    const len = values.length;
    return values
      .map((v, i) => {
        const x = (i / Math.max(len - 1, 1)) * width;
        const y = height - (v / 100) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [values, width, height]);

  return (
    <svg
      className="dash-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent-primary)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={values.length === 0 ? 0.25 : 0.88}
      />
    </svg>
  );
};

interface RingProps {
  percent: number;
}

const CpuRing: React.FC<RingProps> = ({ percent }) => {
  const color = cpuColor(percent);
  return (
    <div
      className="dash-cpu-ring"
      style={{
        background: `conic-gradient(${color} calc(${percent} * 1%), var(--bg-tertiary) 0)`,
      }}
      aria-label={`CPU ${percent}%`}
    >
      <div className="dash-cpu-ring-inner">
        <span style={{ color }}>{percent}%</span>
      </div>
    </div>
  );
};

interface BarProps {
  percent: number;
  warn?: boolean;
}

const Bar: React.FC<BarProps> = ({ percent, warn }) => (
  <div className="dash-bar-track">
    <div
      className="dash-bar-fill"
      style={{
        width: `${percent}%`,
        background: warn ? 'var(--warning)' : 'var(--accent-primary)',
      }}
    />
  </div>
);

export const HostDashCard: React.FC<Props> = ({
  session,
  connected,
  snapshot,
  cpuHistory = [],
  latency,
  onConnect,
  onEdit,
  onFocus,
  onContextMenu,
}) => {
  const { t } = useTranslation('gwshell');
  const stripeColor = session.color_label ?? 'transparent';

  const cpuPct = snapshot?.cpu ? Math.round(snapshot.cpu.total_percent) : 0;
  const memPct = snapshot?.mem ? pct(snapshot.mem.mem_used_bytes, snapshot.mem.mem_total_bytes) : 0;
  const diskPct = snapshot?.disk ? pct(snapshot.disk.used_bytes, snapshot.disk.total_bytes) : 0;
  const loadavg = snapshot?.cpu?.loadavg_1m ?? null;
  const cpuCores = snapshot?.host?.cpu_cores ?? 1;
  const loadHigh = loadavg !== null && loadavg > cpuCores;

  const memLabel = snapshot?.mem
    ? `${formatBytes(snapshot.mem.mem_used_bytes)}/${formatBytes(snapshot.mem.mem_total_bytes)}`
    : '';

  const diskLabel = snapshot?.disk ? `${diskPct}%` : '';
  const hasSnapshot = connected && snapshot != null;

  const createdDisplay = session.created_at
    ? new Date(session.created_at).toLocaleDateString()
    : null;
  const nameTooltip = createdDisplay
    ? `${session.name} · ${t('dash_created_at', { date: createdDisplay })}`
    : session.name;

  const protoInfo = (() => {
    switch (session.session_type) {
      case 'docker':
        return {
          icon: <ProtocolIcon type="docker" size={20} />,
          label: t('newasset_docker'),
          cls: 'proto--docker',
        };
      case 'serial':
        return {
          icon: <ProtocolIcon type="serial" size={20} />,
          label: t('newasset_serial'),
          cls: 'proto--serial',
        };
      case 'localshell':
        return {
          icon: <ProtocolIcon type="localshell" size={20} />,
          label: t('newasset_localshell'),
          cls: 'proto--local',
        };
      default:
        return {
          icon: <ProtocolIcon type="ssh" size={20} />,
          label: t('newasset_ssh'),
          cls: 'proto--ssh',
        };
    }
  })();

  const osPretty = hasSnapshot ? snapshot?.host?.os_pretty : null;
  const osShort = shortOsLabel(osPretty);

  const isPingable = session.session_type === 'ssh';
  const viaRelay = !!session.jump_host || (!!session.proxy_type && session.proxy_type !== 'none');

  const pingBadge: { cls: string; text: string; title?: string } | null = (() => {
    if (!isPingable) return null;
    if (viaRelay) return { cls: '', text: '—', title: t('dash_via_relay_hint') };
    if (typeof latency === 'number') {
      const tone = latency <= 100 ? ' live' : latency <= 300 ? ' warn' : ' bad';
      return { cls: tone, text: `${latency} ms` };
    }
    if (latency === null)
      return { cls: '', text: t('dash_offline', 'Timeout'), title: t('dash_offline_hint') };
    return { cls: '', text: '…', title: t('dash_checking_hint') };
  })();

  const subLine = (() => {
    if (session.username && session.host) {
      return `${session.username}@${session.host}${session.port && session.port !== 22 ? `:${session.port}` : ''}`;
    }
    if (session.host) return session.host;
    switch (session.session_type) {
      case 'serial':
        return session.serial_port
          ? `${session.serial_port}${session.serial_baud_rate ? ` @ ${session.serial_baud_rate}` : ''}`
          : t('newasset_serial');
      case 'localshell':
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        return session.shell_name || t('newasset_localshell');
      case 'docker':
        return session.docker_connect_method?.toLowerCase() === 'ssh'
          ? 'docker via SSH'
          : // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
            session.docker_unix_path || 'docker';
      default:
        return session.session_type;
    }
  })();

  return (
    <div
      className={`dash-card${connected ? ' connected' : ''}`}
      onDoubleClick={() => (connected ? onFocus?.(session) : onConnect(session))}
      onContextMenu={(e) => onContextMenu?.(e, session)}
    >
      {session.color_label && <div className="dash-stripe" style={{ background: stripeColor }} />}

      <div className="dash-card-inner">
        <div className="dash-card-top">
          <div className={`dash-proto-tile ${protoInfo.cls}`} aria-hidden="true">
            {protoInfo.icon}
            {connected && <span className="dash-tile-live-dot" />}
          </div>
          <div className="dash-identity">
            <span className="dash-name" title={nameTooltip}>
              {session.name}
            </span>
            <span className="dash-sub" title={subLine}>
              {subLine}
            </span>
          </div>
          <div className="dash-actions">
            <button
              type="button"
              className="dash-action-btn"
              title={t('table_edit')}
              onClick={() => onEdit(session)}
              aria-label="Edit session"
            >
              <Pencil size={13} />
            </button>
          </div>
        </div>

        {hasSnapshot ? (
          <div className="dash-metrics">
            <div className="dash-metrics-main">
              <CpuRing percent={cpuPct} />
              <div className="dash-metrics-bars">
                <div className="dash-metric-row">
                  <span className="dash-metric-label">MEM</span>
                  <div className="dash-metric-bar-wrap">
                    <Bar percent={memPct} warn={memPct > 85} />
                    <span className="dash-metric-value">{memLabel}</span>
                  </div>
                </div>
                {snapshot?.disk && (
                  <div className="dash-metric-row">
                    <span className="dash-metric-label">{t('dash_disk', 'DISK')}</span>
                    <div className="dash-metric-bar-wrap">
                      <Bar percent={diskPct} warn={diskPct > 85} />
                      <span className="dash-metric-value">
                        {diskLabel} <span className="dash-metric-mount">{snapshot.disk.mount}</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="dash-metrics-footer">
              <div className="dash-metrics-meta">
                {osShort && (
                  <span className="dash-os-chip" title={osPretty ?? ''}>
                    <OsDistroIcon osPretty={osPretty} size={13} />
                    <span>{osShort}</span>
                  </span>
                )}
                {loadavg !== null && (
                  <span
                    className="dash-load-chip"
                    style={{ color: loadHigh ? 'var(--warning)' : 'var(--text-secondary)' }}
                  >
                    {t('dash_load', 'LOAD')} {loadavg.toFixed(2)}
                  </span>
                )}
                <Sparkline values={cpuHistory} />
              </div>
              {onFocus && (
                <button
                  type="button"
                  className="dash-connect-btn dash-connect-btn--open"
                  onClick={() => onFocus(session)}
                >
                  <span>{t('dash_open')}</span>
                  <ArrowUpRight size={13} />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="dash-offline">
            <div className="dash-badges">
              <span className={`dash-type-badge ${protoInfo.cls}`}>{protoInfo.label}</span>
              {pingBadge && (
                <span className={`dash-ping-badge${pingBadge.cls}`} title={pingBadge.title}>
                  {pingBadge.text}
                </span>
              )}
            </div>

            {connected && onFocus ? (
              <button
                type="button"
                className="dash-connect-btn dash-connect-btn--open"
                onClick={() => onFocus(session)}
              >
                <span>{t('dash_open')}</span>
                <ArrowUpRight size={13} />
              </button>
            ) : (
              <button type="button" className="dash-connect-btn" onClick={() => onConnect(session)}>
                <Play size={11} />
                <span>{t('dash_connect', 'Connect')}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default HostDashCard;
