import React, { useMemo } from 'react';
import { Play, Pencil, Box, Usb, TerminalSquare, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SessionConfig } from '../../types';
import type { MetricsSnapshot } from '../../types/serverMetrics';
import './AssetDashboard.css';

interface Props {
  session: SessionConfig;
  connected: boolean;
  snapshot?: MetricsSnapshot | null;
  cpuHistory?: number[];        // 0-100 values for sparkline
  latency?: number | null;      // ping ms (disconnected state)
  onConnect: (s: SessionConfig) => void;
  onEdit: (s: SessionConfig) => void;
  onFocus?: (s: SessionConfig) => void;  // focus existing tab when connected
}

// ---- Helpers ----------------------------------------------------------------

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return (n / 1_073_741_824).toFixed(1) + 'G';
  if (n >= 1_048_576)     return (n / 1_048_576).toFixed(1) + 'M';
  if (n >= 1_024)          return (n / 1_024).toFixed(1) + 'K';
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

// ---- Sparkline SVG ----------------------------------------------------------

interface SparklineProps {
  values: number[];  // 0-100
  width?: number;
  height?: number;
}

const Sparkline: React.FC<SparklineProps> = ({ values, width = 80, height = 24 }) => {
  const points = useMemo(() => {
    if (values.length === 0) {
      // Flat baseline
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
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={values.length === 0 ? 0.25 : 0.8}
      />
    </svg>
  );
};

// ---- CPU Ring ---------------------------------------------------------------

interface RingProps {
  percent: number;  // 0-100
}

const CpuRing: React.FC<RingProps> = ({ percent }) => {
  const color = cpuColor(percent);
  return (
    <div
      className="dash-cpu-ring"
      style={{
        background: `conic-gradient(${color} calc(${percent} * 1%), var(--border-color) 0)`,
      }}
      aria-label={`CPU ${percent}%`}
    >
      <div className="dash-cpu-ring-inner">
        <span style={{ color }}>{percent}%</span>
      </div>
    </div>
  );
};

// ---- Bar ----------------------------------------------------------------

interface BarProps {
  percent: number;  // 0-100
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

// ---- Main component ---------------------------------------------------------

export const HostDashCard: React.FC<Props> = ({
  session,
  connected,
  snapshot,
  cpuHistory = [],
  latency,
  onConnect,
  onEdit,
  onFocus,
}) => {
  const { t } = useTranslation('gwshell');

  // Color stripe: session.color_label or fallback to CSS var (use inline style trick)
  const stripeColor = session.color_label ?? 'var(--border-color)';

  // Derived metrics (only when connected + snapshot)
  const cpuPct    = snapshot?.cpu ? Math.round(snapshot.cpu.total_percent) : 0;
  const memPct    = snapshot?.mem ? pct(snapshot.mem.mem_used_bytes, snapshot.mem.mem_total_bytes) : 0;
  const diskPct   = snapshot?.disk ? pct(snapshot.disk.used_bytes, snapshot.disk.total_bytes) : 0;
  const loadavg   = snapshot?.cpu?.loadavg_1m ?? null;
  const cpuCores  = snapshot?.host?.cpu_cores ?? 1;
  const loadHigh  = loadavg !== null && loadavg > cpuCores;

  const memLabel = snapshot?.mem
    ? `${formatBytes(snapshot.mem.mem_used_bytes)}/${formatBytes(snapshot.mem.mem_total_bytes)}`
    : '';

  const diskLabel = snapshot?.disk
    ? `${diskPct}%`
    : '';

  const hasSnapshot = connected && snapshot != null;

  // Created date lives in the name tooltip — too low-value for a card row.
  const createdDisplay = session.created_at
    ? new Date(session.created_at).toLocaleDateString()
    : null;
  const nameTooltip = createdDisplay
    ? `${session.name} · ${t('dash_created_at', { date: createdDisplay })}`
    : session.name;

  // Every card gets a type badge so the session kind is identifiable at a
  // glance. SSH additionally shows a latency badge alongside it (below); the
  // non-pingable types only show the badge (latency would be meaningless).
  const typeBadge = (() => {
    switch (session.session_type) {
      case 'docker':     return { icon: <Box size={11} />,            label: t('newasset_docker') };
      case 'serial':     return { icon: <Usb size={11} />,            label: t('newasset_serial') };
      case 'localshell': return { icon: <TerminalSquare size={11} />, label: t('newasset_localshell') };
      default:           return { icon: <Server size={11} />,         label: t('newasset_ssh') };
    }
  })();

  // Only SSH sessions have a meaningful TCP latency to display.
  const isPingable = session.session_type === 'ssh';

  // Per-type connection summary for the sub row (raw lowercase type names
  // like "serial" tell the user nothing).
  const subLine = (() => {
    if (session.username && session.host) {
      return `${session.username}@${session.host}${session.port ? `:${session.port}` : ''}`;
    }
    if (session.host) return session.host;
    switch (session.session_type) {
      case 'serial':
        return session.serial_port
          ? `${session.serial_port}${session.serial_baud_rate ? ` @ ${session.serial_baud_rate}` : ''}`
          : t('newasset_serial');
      case 'localshell':
        return session.shell_name || t('newasset_localshell');
      case 'docker':
        return session.docker_connect_method?.toLowerCase() === 'ssh'
          ? 'docker via SSH'
          : session.docker_unix_path || 'docker';
      default:
        return session.session_type;
    }
  })();

  return (
    <div
      className={`dash-card${connected ? ' connected' : ''}`}
      onDoubleClick={() => (connected ? onFocus?.(session) : onConnect(session))}
    >
      {/* Left color stripe */}
      <div className="dash-stripe" style={{ background: stripeColor }} />

      <div className="dash-card-inner">
        {/* Header row */}
        <div className="dash-header">
          <span
            className={`dash-status-dot${connected ? ' online' : ''}`}
            aria-label={connected ? 'Connected' : 'Disconnected'}
          />
          <span className="dash-name" title={nameTooltip}>{session.name}</span>
          <div className="dash-actions">
            <button
              className="dash-action-btn"
              title={t('table_edit')}
              onClick={() => onEdit(session)}
              aria-label="Edit session"
            >
              <Pencil size={13} />
            </button>
          </div>
        </div>

        {/* Sub row: connection summary */}
        <div className="dash-sub">{subLine}</div>

        {/* Body */}
        {hasSnapshot ? (
          /* Connected: live metrics */
          <div className="dash-metrics">
            {/* CPU ring */}
            <div className="dash-metric-row">
              <span className="dash-metric-label">CPU</span>
              <CpuRing percent={cpuPct} />
            </div>

            {/* MEM bar */}
            <div className="dash-metric-row">
              <span className="dash-metric-label">MEM</span>
              <div className="dash-metric-bar-wrap">
                <Bar percent={memPct} warn={memPct > 85} />
                <span className="dash-metric-value">{memLabel}</span>
              </div>
            </div>

            {/* DISK bar (only when disk data present) */}
            {snapshot?.disk && (
              <div className="dash-metric-row">
                <span className="dash-metric-label">{t('dash_disk', 'DISK')}</span>
                <div className="dash-metric-bar-wrap">
                  <Bar percent={diskPct} warn={diskPct > 85} />
                  <span className="dash-metric-value">{diskLabel} <span className="dash-metric-mount">{snapshot.disk.mount}</span></span>
                </div>
              </div>
            )}

            {/* LOAD chip */}
            {loadavg !== null && (
              <div className="dash-metric-row">
                <span className="dash-metric-label">{t('dash_load', 'LOAD')}</span>
                <span
                  className="dash-load-chip"
                  style={{ color: loadHigh ? 'var(--warning)' : 'var(--text-secondary)' }}
                >
                  {loadavg.toFixed(2)}
                </span>
              </div>
            )}

            {/* CPU sparkline (network rx label is optional — use cpuHistory as the series) */}
            <div className="dash-sparkline-wrap">
              <Sparkline values={cpuHistory} />
            </div>
          </div>
        ) : (
          /* Disconnected: type badge (+ latency for SSH) + connect, one row */
          <div className="dash-offline">
            <div className="dash-badges">
              <div className="dash-type-badge">
                {typeBadge.icon}
                {typeBadge.label}
              </div>
              {isPingable && (
                <div className={`dash-ping-badge${latency != null ? ' live' : ''}`}>
                  {latency != null ? `${latency} ms` : t('dash_offline', 'timeout')}
                </div>
              )}
            </div>

            <button
              className="dash-connect-btn"
              onClick={() => onConnect(session)}
            >
              <Play size={12} />
              {t('dash_connect', 'Connect')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default HostDashCard;
