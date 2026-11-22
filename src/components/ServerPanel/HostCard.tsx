import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Cpu, Terminal } from 'lucide-react';
import type { HostInfo } from '../../types/serverMetrics';
import { OsDistroIcon } from '../Icons/BrandIcons';
import { fmtUptime, platformDisplayLabel } from './format';

interface Props {
  host: HostInfo | null;
  hostIp: string;
}

const firstNonEmpty = (...vals: (string | undefined)[]): string => {
  for (const v of vals) {
    if (v && v.trim().length > 0) return v;
  }
  return '';
};

export const HostCard: React.FC<Props> = ({ host, hostIp }) => {
  const { t } = useTranslation();
  const placeholder = '—';
  const osSource = firstNonEmpty(host?.os_pretty, host?.kernel, host?.platform);
  const osTitle = firstNonEmpty(host?.os_pretty, host?.kernel);
  const platformTag = platformDisplayLabel(host?.platform);
  const targetHost = firstNonEmpty(hostIp, host?.hostname);

  return (
    <div className="sp-card sp-hero-host">
      <div className="sp-host-top">
        <div className="sp-host-os-icon">
          <OsDistroIcon osPretty={osSource} size={28} />
        </div>
        <div className="sp-host-meta">
          <div className="sp-host-title-row">
            <span className="sp-host-os-name" title={osTitle}>
              {osTitle || placeholder}
            </span>
            {platformTag && (
              <span className={`sp-platform-pill is-${(host?.platform ?? 'linux').toLowerCase()}`}>
                {platformTag}
              </span>
            )}
          </div>
          <div className="sp-host-sub" title={hostIp}>
            {host?.user ? `${host.user}@${targetHost}` : targetHost || placeholder}
          </div>
        </div>
      </div>

      <div className="sp-host-chips">
        <span className="sp-host-chip" title={t('serverPanel_host_uptime')}>
          <Clock size={11} />
          <span>{host ? fmtUptime(host.uptime_seconds) : placeholder}</span>
        </span>
        {host?.kernel && (
          <span className="sp-host-chip" title={host.kernel}>
            <Terminal size={11} />
            <span className="sp-host-chip__trunc">{host.kernel}</span>
          </span>
        )}
        {host?.cpu_model && (
          <span className="sp-host-chip sp-host-chip--wide" title={host.cpu_model}>
            <Cpu size={11} />
            <span className="sp-host-chip__trunc">{host.cpu_model}</span>
          </span>
        )}
      </div>
    </div>
  );
};
