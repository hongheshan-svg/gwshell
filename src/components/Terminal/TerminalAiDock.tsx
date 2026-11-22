import React from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  Copy,
  Folder,
  Plus,
  RotateCcw,
  SendHorizontal,
  ShieldCheck,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTerminalAiChat } from '../../hooks/useTerminalAiChat';

export const TerminalAiDock: React.FC = () => {
  const { t } = useTranslation();
  const chat = useTerminalAiChat();

  if (!chat.activeTab) return null;

  if (!chat.open) {
    return (
      <button
        className="terminal-ai-fab"
        onClick={() => chat.setOpen(true)}
        title={t('terminal_ai_open')}
        type="button"
      >
        <Bot size={18} />
      </button>
    );
  }

  return (
    <div className="terminal-ai-dock">
      <div className="terminal-ai-topbar">
        <div className="terminal-ai-context">
          <span className="terminal-ai-chip">
            <Folder size={15} /> {chat.cwdChip}
          </span>
          <span className="terminal-ai-chip">{chat.promptChip}</span>
          <span
            className={`terminal-ai-chip terminal-ai-context-tag${chat.selectionChars > 0 ? ' is-active' : ''}`}
            title={t('terminal_ai_context_selection', { chars: chat.selectionChars })}
          >
            {t('terminal_ai_context_selection_label')}{' '}
            {chat.selectionChars > 0 ? chat.selectionChars : '—'}
          </span>
          <span
            className={`terminal-ai-chip terminal-ai-context-tag${chat.outputKb > 0 ? ' is-active' : ''}`}
            title={t('terminal_ai_context_output', { kb: chat.outputKb })}
          >
            {t('terminal_ai_context_output_label')} {chat.outputKb > 0 ? `${chat.outputKb}KB` : '—'}
          </span>
        </div>
        <button
          className="terminal-ai-icon-btn"
          onClick={() => {
            if (chat.busy) chat.stopWaiting(false);
            chat.setOpen(false);
          }}
          title={t('terminal_ai_close')}
          type="button"
        >
          <X size={16} />
        </button>
      </div>

      {(chat.answer || chat.error || chat.busy || chat.notice) && (
        <div className="terminal-ai-response">
          {chat.answer && (
            <div className="terminal-ai-answer">
              <pre>{chat.answer}</pre>
              <button
                className="terminal-ai-copy"
                onClick={() => void chat.copyAnswer()}
                title={t('terminal_ai_copy_answer')}
                type="button"
              >
                {chat.copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{chat.copied ? t('terminal_ai_copied') : t('terminal_ai_copy')}</span>
              </button>
            </div>
          )}
          {chat.commandSuggestions.length > 0 && (
            <div className="terminal-ai-command-list">
              <div className="terminal-ai-command-title">
                {t('terminal_ai_command_suggestions')}
              </div>
              {chat.commandSuggestions.map((command) => (
                <button
                  className="terminal-ai-command-chip"
                  key={command}
                  onClick={() => chat.insertCommand(command)}
                  title={command}
                  type="button"
                >
                  <TerminalSquare size={14} />
                  <code>{command}</code>
                  <span>{t('terminal_ai_insert_command')}</span>
                </button>
              ))}
            </div>
          )}
          {chat.busy && (
            <div className="terminal-ai-busy-row">
              <span className="terminal-ai-muted">{chat.phase || t('terminal_ai_thinking')}</span>
              <button className="terminal-ai-stop" onClick={() => chat.stopWaiting()} type="button">
                {t('terminal_ai_stop_waiting')}
              </button>
            </div>
          )}
          {chat.notice && !chat.busy && <span className="terminal-ai-muted">{chat.notice}</span>}
          {chat.error && (
            <div className="terminal-ai-error-box">
              <AlertCircle size={14} />
              <span>{chat.error}</span>
            </div>
          )}
        </div>
      )}

      <textarea
        ref={chat.textareaRef}
        className="terminal-ai-input"
        disabled={chat.busy}
        onChange={(event) => chat.setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void chat.askAgent();
          }
        }}
        placeholder={t('terminal_ai_placeholder')}
        value={chat.input}
      />

      <div className="terminal-ai-toolbar">
        <button
          className="terminal-ai-primary"
          disabled={!chat.input.trim() || chat.busy}
          onClick={chat.executeInput}
          type="button"
        >
          <TerminalSquare size={15} /> {t('terminal_ai_execute')}
        </button>
        <button
          className="terminal-ai-ghost"
          disabled={!chat.input.trim() || chat.busyTabId !== null}
          onClick={() => void chat.askAgent()}
          type="button"
        >
          <Bot size={15} /> {t('terminal_ai_agent')}
        </button>
        <button
          className={`terminal-ai-model${chat.modelReady ? ' is-ready' : ' is-missing'}`}
          onClick={() => chat.openSettingsNav('agent-ai')}
          title={chat.modelMeta}
          type="button"
        >
          {chat.modelReady ? <Bot size={15} /> : <Plus size={15} />}
          <span>{chat.modelReady ? chat.modelLabel : t('terminal_ai_add_model')}</span>
        </button>
        <button
          className="terminal-ai-icon-btn"
          onClick={chat.clearResponse}
          title={t('terminal_ai_clear')}
          type="button"
        >
          <RotateCcw size={15} />
        </button>
        <span className="terminal-ai-safe">
          <ShieldCheck size={15} />
        </span>
        <span className="terminal-ai-count">{chat.input.length}</span>
        <button
          className="terminal-ai-send"
          disabled={!chat.input.trim() || chat.busyTabId !== null}
          onClick={() => void chat.askAgent()}
          type="button"
        >
          <SendHorizontal size={18} />
        </button>
      </div>
    </div>
  );
};
