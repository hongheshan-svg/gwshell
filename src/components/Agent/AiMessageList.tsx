import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  RotateCw,
  Settings,
  Terminal,
  User,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AiChatMessage } from '../../stores/aiChatStore';
import { writeClipboardText } from '../../lib/terminalClipboard';
import type { CommandRiskLevel } from '../../types/agent';
import { AiMarkdownView } from './AiMarkdownView';

interface AiMessageListProps {
  messages: AiChatMessage[];
  streamingPhase: string;
  hasActiveTerminal: boolean;
  canExecSsh: boolean;
  isBusy: boolean;
  runningCommand: string | null;
  onRunCommand: (command: string, risk: CommandRiskLevel) => void;
  onInsertCommand: (command: string) => void;
  onRunAndAnalyze: (command: string, risk: CommandRiskLevel) => void;
  onRetry: () => void;
  onOpenSettings: () => void;
}

const ThinkingBlock: React.FC<{ thinking: string; streaming?: boolean }> = ({
  thinking,
  streaming,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(Boolean(streaming));

  useEffect(() => {
    if (!streaming) setExpanded(false);
  }, [streaming]);

  return (
    <div className="ai-thinking">
      <button type="button" className="ai-thinking-toggle" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{streaming ? t('ai_phase_thinking') : t('ai_thinking_label')}</span>
      </button>
      {expanded && <pre className="ai-thinking-body">{thinking}</pre>}
    </div>
  );
};

const ToolResultMessage: React.FC<{ message: AiChatMessage }> = ({ message }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const tr = message.toolResult;
  if (!tr) return null;

  return (
    <div className={`ai-tool-card ${tr.ok ? 'is-ok' : 'is-err'}`}>
      <button type="button" className="ai-tool-header" onClick={() => setExpanded((v) => !v)}>
        <span className="ai-tool-title">
          <Terminal size={12} />
          <code>{tr.command}</code>
        </span>
        <span className={`ai-tool-status ${tr.ok ? 'is-ok' : 'is-err'}`}>
          {tr.ok ? <Check size={11} /> : <XCircle size={11} />}
          <span>{tr.ok ? t('ai_tool_ok') : t('ai_tool_failed')}</span>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {expanded && (
        <pre className="ai-tool-output">
          {tr.output.length > 0 ? tr.output : (tr.error ?? t('ai_tool_empty_output'))}
        </pre>
      )}
    </div>
  );
};

const AssistantMessageCard: React.FC<{
  message: AiChatMessage;
  streamingPhase: string;
  hasActiveTerminal: boolean;
  canExecSsh: boolean;
  isBusy: boolean;
  runningCommand: string | null;
  onRunCommand: (command: string, risk: CommandRiskLevel) => void;
  onInsertCommand: (command: string) => void;
  onRunAndAnalyze: (command: string, risk: CommandRiskLevel) => void;
  onRetry: () => void;
  onOpenSettings: () => void;
}> = ({
  message,
  streamingPhase,
  hasActiveTerminal,
  canExecSsh,
  isBusy,
  runningCommand,
  onRunCommand,
  onInsertCommand,
  onRunAndAnalyze,
  onRetry,
  onOpenSettings,
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopyAll = () => {
    if (!message.content) return;
    void writeClipboardText(message.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="ai-msg ai-msg--assistant">
      <div className="ai-msg-avatar ai-msg-avatar--bot">
        <Bot size={13} />
      </div>
      <div className="ai-msg-body">
        {message.thinking && (
          <ThinkingBlock
            thinking={message.thinking}
            streaming={message.streaming && !message.content}
          />
        )}
        {message.content ? (
          <AiMarkdownView
            content={message.content}
            hasActiveTerminal={hasActiveTerminal}
            canExecSsh={canExecSsh}
            isBusy={isBusy}
            runningCommand={runningCommand}
            onRunCommand={onRunCommand}
            onInsertCommand={onInsertCommand}
            onRunAndAnalyze={onRunAndAnalyze}
          />
        ) : message.streaming ? (
          <div className="ai-streaming-status">
            <Loader2 size={13} className="spin" />
            <span>{streamingPhase || t('terminal_ai_thinking')}</span>
          </div>
        ) : null}

        {message.streaming && message.content && (
          <div className="ai-streaming-caret">
            <Loader2 size={11} className="spin" />
            <span>{streamingPhase || t('terminal_ai_phase_streaming')}</span>
          </div>
        )}

        {message.error && (
          <div className="ai-msg-error">
            <div className="ai-msg-error-row">
              <AlertCircle size={13} />
              <span>{message.error}</span>
            </div>
            <div className="ai-msg-error-actions">
              <button type="button" className="ai-cmd-btn" disabled={isBusy} onClick={onRetry}>
                <RotateCw size={11} />
                <span>{t('ai_retry')}</span>
              </button>
              <button type="button" className="ai-cmd-btn" onClick={onOpenSettings}>
                <Settings size={11} />
                <span>{t('ai_open_settings')}</span>
              </button>
            </div>
          </div>
        )}

        {!message.streaming && message.content && (
          <div className="ai-msg-footer">
            {message.requestedModel && (
              <span
                className="ai-msg-model-tag"
                title={
                  message.responseModel && message.responseModel !== message.requestedModel
                    ? `${message.requestedModel} → ${message.responseModel}`
                    : message.requestedModel
                }
              >
                {message.responseModel && message.responseModel !== message.requestedModel
                  ? `${message.requestedModel} → ${message.responseModel}`
                  : message.requestedModel}
              </span>
            )}
            <button
              type="button"
              className="ai-msg-copy-btn"
              onClick={handleCopyAll}
              title={t('terminal_ai_copy_answer')}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              <span>{copied ? t('terminal_ai_copied') : t('terminal_ai_copy')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export const AiMessageList: React.FC<AiMessageListProps> = ({
  messages,
  streamingPhase,
  hasActiveTerminal,
  canExecSsh,
  isBusy,
  runningCommand,
  onRunCommand,
  onInsertCommand,
  onRunAndAnalyze,
  onRetry,
  onOpenSettings,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedToBottomRef.current = distance < 48;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="ai-messages" ref={scrollRef} onScroll={handleScroll}>
      {messages.map((msg) => {
        if (msg.role === 'user') {
          return (
            <div className="ai-msg ai-msg--user" key={msg.id}>
              <div className="ai-msg-bubble">{msg.content}</div>
              <div className="ai-msg-avatar ai-msg-avatar--user">
                <User size={12} />
              </div>
            </div>
          );
        }
        if (msg.role === 'tool') {
          return <ToolResultMessage key={msg.id} message={msg} />;
        }
        return (
          <AssistantMessageCard
            key={msg.id}
            message={msg}
            streamingPhase={streamingPhase}
            hasActiveTerminal={hasActiveTerminal}
            canExecSsh={canExecSsh}
            isBusy={isBusy}
            runningCommand={runningCommand}
            onRunCommand={onRunCommand}
            onInsertCommand={onInsertCommand}
            onRunAndAnalyze={onRunAndAnalyze}
            onRetry={onRetry}
            onOpenSettings={onOpenSettings}
          />
        );
      })}
    </div>
  );
};
