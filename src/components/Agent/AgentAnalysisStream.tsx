import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';

export const AgentAnalysisStream: React.FC = () => {
  const { t } = useTranslation();
  const text = useAgentStore((s) => s.analysisText);
  const update = useAgentStore((s) => s.latestUpdate);

  return (
    <div className="agent-analysis">
      {update && (
        <div className="agent-analysis-summary">
          <div className="agent-analysis-summary-title">{update.summary}</div>
          {update.findings.length > 0 && (
            <div className="agent-analysis-finding-list">
              {update.findings.map((finding) => (
                <div className="agent-analysis-finding" key={finding.id}>
                  <span>{finding.severity}</span>
                  {finding.title}
                </div>
              ))}
            </div>
          )}
          {update.questions.length > 0 && (
            <ul className="agent-analysis-questions">
              {update.questions.map((question, index) => (
                <li key={`${index}-${question}`}>{question}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <pre className="agent-analysis-stream">{text || t('agent_no_analysis')}</pre>
    </div>
  );
};
