import React from 'react';
import { useAgentStore } from '../../stores/agentStore';

export const AgentAuditTimeline: React.FC = () => {
  const results = useAgentStore((s) => s.results);
  return (
    <div className="agent-audit">
      {results.map((result) => (
        <div className="agent-audit-row" key={result.call_id}>
          <span>{result.ok ? 'OK' : 'FAIL'}</span>
          <pre>{result.output || result.error}</pre>
          {result.verification && <pre>Verification: {result.verification.output || result.verification.error}</pre>}
        </div>
      ))}
    </div>
  );
};
