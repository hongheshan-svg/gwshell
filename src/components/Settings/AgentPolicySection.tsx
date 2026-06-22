import React from 'react';
import { AlertCircle, CheckCircle2, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentPolicySettings } from '../../types/agent';
import { PolicyAutoAnalysis } from './policy/PolicyAutoAnalysis';
import { PolicyAutoExecution } from './policy/PolicyAutoExecution';
import { PolicyMaintenance } from './policy/PolicyMaintenance';
import { PolicyAlerts } from './policy/PolicyAlerts';

interface Props {
  policy: AgentPolicySettings;
  busy: boolean;
  onChange: (partial: Partial<AgentPolicySettings>) => void;
  onSave: () => void;
  message: { kind: 'ok' | 'err'; text: string } | null;
}

export const AgentPolicySection: React.FC<Props> = ({ policy, busy, onChange, onSave, message }) => {
  const { t } = useTranslation();
  return (
    <>
      <div className="settings-section-title" style={{ marginTop: 12 }}>{t('agent_policy_title')}</div>
      <div className="policy-card-grid">
        <PolicyAutoAnalysis policy={policy} busy={busy} onChange={onChange} />
        <PolicyAutoExecution policy={policy} busy={busy} onChange={onChange} />
        <PolicyMaintenance policy={policy} busy={busy} onChange={onChange} />
        <PolicyAlerts policy={policy} busy={busy} onChange={onChange} />
      </div>
      <div className="settings-row" style={{ marginTop: 4 }}>
        <span className="settings-row-left">
          <span className="settings-desc">{t('agent_policy_save_hint')}</span>
        </span>
        <span className="settings-row-right">
          <button className="settings-btn-primary" disabled={busy} onClick={onSave} type="button">
            <Save size={14} />
            {t('agent_policy_save')}
          </button>
        </span>
      </div>
      {message && (
        <div className={`ai-settings-message ${message.kind}`}>
          {message.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{message.text}</span>
        </div>
      )}
    </>
  );
};
