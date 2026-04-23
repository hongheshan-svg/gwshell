import React from 'react';
import { useTranslation } from 'react-i18next';
import type { HostInfo } from '../../types/serverMetrics';

interface Props {
  host: HostInfo | null;
  hostIp: string;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

export const HostCard: React.FC<Props> = ({ host, hostIp }) => {
  const { t } = useTranslation();
  const placeholder = '—';

  return (
    <div className="sp-card sp-card--host">
      <div className="sp-grid-2">
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_host_user')}</span>
          <span className="sp-kv__v">{host?.user || placeholder}</span>
        </div>
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_host_uptime')}</span>
          <span className="sp-kv__v">
            {host ? formatUptime(host.uptime_seconds) : placeholder}
          </span>
        </div>
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_host_host')}</span>
          <span className="sp-kv__v" title={hostIp}>{hostIp || placeholder}</span>
        </div>
        <div className="sp-kv">
          <span className="sp-kv__k">{t('serverPanel_host_system')}</span>
          <span className="sp-kv__v" title={host?.os_pretty ?? ''}>
            {host?.os_pretty || placeholder}
          </span>
        </div>
      </div>
    </div>
  );
};
