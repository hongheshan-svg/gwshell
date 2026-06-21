import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentPolicySettings } from '../../../types/agent';

interface Props {
  policy: AgentPolicySettings;
  busy: boolean;
  onChange: (partial: Partial<AgentPolicySettings>) => void;
}

export const PolicyMaintenance: React.FC<Props> = ({ policy, busy, onChange }) => {
  const { t } = useTranslation();
  const timeDisabled = busy || !policy.maintenance_window_enabled;
  return (
    <div className="policy-card">
      <div className="policy-card-title">{t('agent_policy_card_maintenance')}</div>
      <label className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_maintenance_window')}</span>
        </span>
        <span className="settings-row-right">
          <button
            className={`settings-toggle ${policy.maintenance_window_enabled ? 'on' : ''}`}
            disabled={busy}
            onClick={() => onChange({ maintenance_window_enabled: !policy.maintenance_window_enabled })}
            type="button"
          >
            <span className="settings-toggle-knob" />
          </button>
        </span>
      </label>
      <div className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_maintenance_time')}</span>
        </span>
        <span className="settings-row-right">
          <input
            className="settings-input"
            disabled={timeDisabled}
            style={{ width: 90 }}
            type="time"
            value={policy.maintenance_window_start}
            onChange={(e) => onChange({ maintenance_window_start: e.target.value })}
          />
          <input
            className="settings-input"
            disabled={timeDisabled}
            style={{ width: 90, marginLeft: 8 }}
            type="time"
            value={policy.maintenance_window_end}
            onChange={(e) => onChange({ maintenance_window_end: e.target.value })}
          />
        </span>
      </div>
    </div>
  );
};
