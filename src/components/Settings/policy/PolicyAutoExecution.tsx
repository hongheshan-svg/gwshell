import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentPolicySettings } from '../../../types/agent';

interface Props {
  policy: AgentPolicySettings;
  busy: boolean;
  onChange: (partial: Partial<AgentPolicySettings>) => void;
}

export const PolicyAutoExecution: React.FC<Props> = ({ policy, busy, onChange }) => {
  const { t } = useTranslation();
  const [listsOpen, setListsOpen] = useState(false);
  return (
    <div className="policy-card">
      <div className="policy-card-title">{t('agent_policy_card_execution')}</div>
      <label className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_auto_read_only')}</span>
        </span>
        <span className="settings-row-right">
          <button
            className={`settings-toggle ${policy.auto_execute_read_only ? 'on' : ''}`}
            disabled={busy}
            onClick={() => onChange({ auto_execute_read_only: !policy.auto_execute_read_only })}
            type="button"
          >
            <span className="settings-toggle-knob" />
          </button>
        </span>
      </label>
      <label className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_auto_low')}</span>
        </span>
        <span className="settings-row-right">
          <button
            className={`settings-toggle ${policy.auto_execute_low_risk ? 'on' : ''}`}
            disabled={busy}
            onClick={() => onChange({ auto_execute_low_risk: !policy.auto_execute_low_risk })}
            type="button"
          >
            <span className="settings-toggle-knob" />
          </button>
        </span>
      </label>
      <button
        className="policy-card-collapse-btn"
        disabled={busy}
        onClick={() => setListsOpen((v) => !v)}
        type="button"
      >
        {listsOpen ? t('agent_policy_lists_collapse') : t('agent_policy_lists_expand')}
      </button>
      {listsOpen && (
        <div className="policy-card-lists">
          <label className="settings-row">
            <span className="settings-row-left">
              <span className="settings-label">{t('agent_policy_command_allowlist')}</span>
              <span className="settings-desc">{t('agent_policy_one_per_line')}</span>
            </span>
            <span className="settings-row-right">
              <textarea
                className="settings-input"
                disabled={busy}
                style={{ width: 280, minHeight: 58 }}
                value={policy.auto_execute_command_allowlist.join('\n')}
                onChange={(e) =>
                  onChange({
                    auto_execute_command_allowlist: e.target.value.split('\n').map((line) => line.trim()).filter(Boolean),
                  })
                }
              />
            </span>
          </label>
          <label className="settings-row">
            <span className="settings-row-left">
              <span className="settings-label">{t('agent_policy_service_denylist')}</span>
              <span className="settings-desc">{t('agent_policy_one_per_line')}</span>
            </span>
            <span className="settings-row-right">
              <textarea
                className="settings-input"
                disabled={busy}
                style={{ width: 280, minHeight: 58 }}
                value={policy.auto_execute_service_denylist.join('\n')}
                onChange={(e) =>
                  onChange({
                    auto_execute_service_denylist: e.target.value.split('\n').map((line) => line.trim()).filter(Boolean),
                  })
                }
              />
            </span>
          </label>
        </div>
      )}
    </div>
  );
};
