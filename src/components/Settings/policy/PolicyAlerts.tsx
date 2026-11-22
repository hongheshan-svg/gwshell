import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentPolicySettings } from '../../../types/agent';

interface Props {
  policy: AgentPolicySettings;
  busy: boolean;
  onChange: (partial: Partial<AgentPolicySettings>) => void;
}

const parseKeywords = (raw: string) =>
  raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const PolicyAlerts: React.FC<Props> = ({ policy, busy, onChange }) => {
  const { t } = useTranslation();
  const keywordDisabled = busy || !policy.log_filter_enabled;
  const [keywordsText, setKeywordsText] = useState(() => policy.log_interest_keywords.join(', '));

  useEffect(() => {
    const joined = policy.log_interest_keywords.join(', ');
    setKeywordsText((prev) => (parseKeywords(prev).join(', ') === joined ? prev : joined));
  }, [policy.log_interest_keywords]);

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
            value={keywordsText}
            onChange={(e) => {
              const raw = e.target.value;
              setKeywordsText(raw);
              onChange({ log_interest_keywords: parseKeywords(raw) });
            }}
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
            onChange={(e) =>
              onChange({
                disk_alert_percent: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 90)),
              })
            }
          />
          <input
            className="settings-input"
            disabled={busy}
            max={100}
            min={1}
            style={{ width: 80, marginLeft: 8 }}
            type="number"
            value={policy.memory_alert_percent}
            onChange={(e) =>
              onChange({
                memory_alert_percent: Math.max(
                  1,
                  Math.min(100, parseInt(e.target.value, 10) || 90),
                ),
              })
            }
          />
        </span>
      </div>
    </div>
  );
};
