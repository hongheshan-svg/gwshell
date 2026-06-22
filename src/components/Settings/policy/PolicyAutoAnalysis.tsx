import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentPolicySettings } from '../../../types/agent';

interface Props {
  policy: AgentPolicySettings;
  busy: boolean;
  onChange: (partial: Partial<AgentPolicySettings>) => void;
}

export const PolicyAutoAnalysis: React.FC<Props> = ({ policy, busy, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="policy-card">
      <div className="policy-card-title">{t('agent_policy_card_analysis')}</div>
      <label className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_auto_continue')}</span>
        </span>
        <span className="settings-row-right">
          <button
            className={`settings-toggle ${policy.auto_continue_enabled ? 'on' : ''}`}
            disabled={busy}
            onClick={() => onChange({ auto_continue_enabled: !policy.auto_continue_enabled })}
            type="button"
          >
            <span className="settings-toggle-knob" />
          </button>
        </span>
      </label>
      <label className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_live_log_auto')}</span>
        </span>
        <span className="settings-row-right">
          <button
            className={`settings-toggle ${policy.live_log_auto_analysis ? 'on' : ''}`}
            disabled={busy}
            onClick={() => onChange({ live_log_auto_analysis: !policy.live_log_auto_analysis })}
            type="button"
          >
            <span className="settings-toggle-knob" />
          </button>
        </span>
      </label>
      <div className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_max_continuations')}</span>
        </span>
        <span className="settings-row-right">
          <input
            className="settings-input"
            disabled={busy}
            max={30}
            min={1}
            style={{ width: 90 }}
            type="number"
            value={policy.max_auto_continuations}
            onChange={(e) =>
              onChange({
                max_auto_continuations: Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 8)),
              })
            }
          />
        </span>
      </div>
    </div>
  );
};
