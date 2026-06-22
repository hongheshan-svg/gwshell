import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentPolicySettings } from '../../../types/agent';

interface Props {
  policy: AgentPolicySettings;
  busy: boolean;
  onChange: (partial: Partial<AgentPolicySettings>) => void;
}

export const PolicyAlerts: React.FC<Props> = ({ policy, busy, onChange }) => {
  const { t } = useTranslation();
  const keywordDisabled = busy || !policy.log_filter_enabled;
  return (
    <div className="policy-card">
      <div className="policy-card-title">{t('agent_policy_card_alerts')}</div>
      <label className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_log_filter')}</span>
        </span>
        <span className="settings-row-right">
          <button
            className={`settings-toggle ${policy.log_filter_enabled ? 'on' : ''}`}
            disabled={busy}
            onClick={() => onChange({ log_filter_enabled: !policy.log_filter_enabled })}
            type="button"
          >
            <span className="settings-toggle-knob" />
          </button>
        </span>
      </label>
      <div className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_log_keywords')}</span>
        </span>
        <span className="settings-row-right">
          <input
            className="settings-input"
            disabled={keywordDisabled}
            style={{ width: 280 }}
            value={policy.log_interest_keywords.join(', ')}
            onChange={(e) =>
              onChange({
                log_interest_keywords: e.target.value.split(',').map((item) => item.trim()).filter(Boolean),
              })
            }
          />
        </span>
      </div>
      <div className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_alert_thresholds')}</span>
        </span>
        <span className="settings-row-right">
          <input
            className="settings-input"
            disabled={busy}
            max={100}
            min={1}
            style={{ width: 80 }}
            type="number"
            value={policy.disk_alert_percent}
            onChange={(e) => onChange({ disk_alert_percent: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 90)) })}
          />
          <input
            className="settings-input"
            disabled={busy}
            max={100}
            min={1}
            style={{ width: 80, marginLeft: 8 }}
            type="number"
            value={policy.memory_alert_percent}
            onChange={(e) => onChange({ memory_alert_percent: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 90)) })}
          />
        </span>
      </div>
      <label className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_alert_auto_start')}</span>
        </span>
        <span className="settings-row-right">
          <button
            className={`settings-toggle ${policy.alert_auto_start_agent ? 'on' : ''}`}
            disabled={busy}
            onClick={() => onChange({ alert_auto_start_agent: !policy.alert_auto_start_agent })}
            type="button"
          >
            <span className="settings-toggle-knob" />
          </button>
        </span>
      </label>
    </div>
  );
};
