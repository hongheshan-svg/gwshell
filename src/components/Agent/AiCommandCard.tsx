import React, { useState } from 'react';
import {
  Check,
  Copy,
  CornerDownLeft,
  Loader2,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { writeClipboardText } from '../../lib/terminalClipboard';
import type { CommandRiskLevel } from '../../types/agent';

interface AiCommandCardProps {
  command: string;
  rawCode: string;
  lang: string;
  risk: CommandRiskLevel;
  hasActiveTerminal: boolean;
  canExecSsh: boolean;
  isBusy: boolean;
  runningCommand: string | null;
  onRun: (command: string, risk: CommandRiskLevel) => void;
  onInsert: (command: string) => void;
  onRunAndAnalyze: (command: string, risk: CommandRiskLevel) => void;
}

export const AiCommandCard: React.FC<AiCommandCardProps> = ({
  command,
  rawCode,
  lang,
  risk,
  hasActiveTerminal,
  canExecSsh,
  isBusy,
  runningCommand,
  onRun,
  onInsert,
  onRunAndAnalyze,
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const isThisRunning = runningCommand === command;

  const riskLabel =
    risk === 'safe'
      ? t('ai_risk_safe')
      : risk === 'low'
        ? t('ai_risk_low')
        : risk === 'medium'
          ? t('ai_risk_medium')
          : t('ai_risk_high');

  const handleCopy = () => {
    void writeClipboardText(command).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className={`ai-cmd-card ai-cmd-risk-${risk}`}>
      <div className="ai-cmd-header">
        <span className="ai-cmd-lang">{lang || 'shell'}</span>
        <span className={`ai-risk-pill is-${risk}`}>
          {risk === 'safe' || risk === 'low' ? (
            <ShieldCheck size={11} />
          ) : (
            <ShieldAlert size={11} />
          )}
          <span>{riskLabel}</span>
        </span>
      </div>
      <pre className="ai-cmd-code">
        <code>{rawCode}</code>
      </pre>
      <div className="ai-cmd-actions">
        {hasActiveTerminal && (
          <>
            <button
              type="button"
              className="ai-cmd-btn ai-cmd-btn--primary"
              disabled={isBusy}
              onClick={() => onRun(command, risk)}
              title={t('ai_cmd_run_title')}
            >
              <Play size={11} />
              <span>{t('ai_cmd_run')}</span>
            </button>
            <button
              type="button"
              className="ai-cmd-btn"
              disabled={isBusy}
              onClick={() => onInsert(command)}
              title={t('ai_cmd_insert_title')}
            >
              <CornerDownLeft size={11} />
              <span>{t('ai_cmd_insert')}</span>
            </button>
          </>
        )}
        {canExecSsh && (
          <button
            type="button"
            className="ai-cmd-btn ai-cmd-btn--agent"
            disabled={isBusy || runningCommand !== null}
            onClick={() => onRunAndAnalyze(command, risk)}
            title={t('ai_cmd_run_analyze_title')}
          >
            {isThisRunning ? <Loader2 size={11} className="spin" /> : <Sparkles size={11} />}
            <span>{isThisRunning ? t('ai_cmd_running') : t('ai_cmd_run_analyze')}</span>
          </button>
        )}
        <button
          type="button"
          className="ai-cmd-btn ai-cmd-btn--copy"
          onClick={handleCopy}
          title={t('terminal_ai_copy')}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span>{copied ? t('terminal_ai_copied') : t('terminal_ai_copy')}</span>
        </button>
      </div>
    </div>
  );
};
