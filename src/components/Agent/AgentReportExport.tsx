import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';

export const AgentReportExport: React.FC = () => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const activeSession = useAgentStore((s) => s.activeSession);
  const evidence = useAgentStore((s) => s.evidence);
  const latestUpdate = useAgentStore((s) => s.latestUpdate);
  const actions = useAgentStore((s) => s.actions);
  const results = useAgentStore((s) => s.results);

  const markdown = () => {
    const lines = [
      `# GWShell Agent Report`,
      '',
      `Objective: ${activeSession?.objective ?? ''}`,
      `Status: ${activeSession?.status ?? 'n/a'}`,
      '',
      `## Summary`,
      latestUpdate?.summary ?? '',
      '',
      `## Findings`,
      ...(latestUpdate?.findings.map((finding) => `- [${finding.severity}] ${finding.title} (${finding.confidence})`) ?? ['- n/a']),
      '',
      `## Actions`,
      ...actions.map((action) => `- ${action.tool}: ${action.reason}`),
      '',
      `## Results`,
      ...results.map((result) => `- ${result.call_id}: ${result.ok ? 'ok' : result.error ?? 'failed'}`),
      '',
      `## Evidence`,
      ...evidence.map((item) => `### ${item.label}\n\n\`\`\`\n${item.body}\n\`\`\``),
    ];
    return lines.join('\n');
  };

  const copy = async () => {
    await navigator.clipboard.writeText(markdown());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button className="settings-btn-outline" disabled={!activeSession} onClick={() => void copy()} type="button">
      {copied ? t('agent_report_copied') : t('agent_report_copy')}
    </button>
  );
};
