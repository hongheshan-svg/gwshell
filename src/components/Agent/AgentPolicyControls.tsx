import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentPolicyStore } from '../../stores/agentPolicyStore';
import type { AgentPolicySettings } from '../../types/agent';

export const AgentPolicyControls: React.FC = () => {
  const { t } = useTranslation();
  const policy = useAgentPolicyStore((s) => s.policy);
  const loaded = useAgentPolicyStore((s) => s.loaded);
  const load = useAgentPolicyStore((s) => s.load);
  const save = useAgentPolicyStore((s) => s.save);
  const [busyKey, setBusyKey] = useState<keyof AgentPolicySettings | null>(null);

  useEffect(() => {
    if (!loaded) {
      load().catch(() => {});
    }
  }, [load, loaded]);

  const toggle = async (key: 'auto_continue_enabled' | 'live_log_auto_analysis') => {
    const next = { ...policy, [key]: !policy[key] };
    setBusyKey(key);
    try {
      await save(next);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="agent-policy-controls">
      <button
        className={`agent-policy-toggle ${policy.auto_continue_enabled ? 'on' : ''}`}
        disabled={busyKey !== null}
        onClick={() => void toggle('auto_continue_enabled')}
        type="button"
      >
        {t('agent_policy_auto_continue_short')}
      </button>
      <button
        className={`agent-policy-toggle ${policy.live_log_auto_analysis ? 'on' : ''}`}
        disabled={busyKey !== null}
        onClick={() => void toggle('live_log_auto_analysis')}
        type="button"
      >
        {t('agent_policy_live_log_auto_short')}
      </button>
    </div>
  );
};
