import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';

export const AgentAnalysisStream: React.FC = () => {
  const { t } = useTranslation();
  const text = useAgentStore((s) => s.analysisText);
  return <pre className="agent-analysis-stream">{text || t('agent_no_analysis')}</pre>;
};
