import React, { useEffect, useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  MessageSquare,
  Network,
  Paperclip,
  RotateCcw,
  SendHorizontal,
  Settings,
  Sparkles,
  Square,
  Terminal,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { usePanelResize } from '../../hooks/usePanelResize';
import { useAiAssistant } from '../../hooks/useAiAssistant';
import { ProtocolIcon, type ProtocolIconType } from '../Icons/BrandIcons';
import type { TabInfo } from '../../types';
import { AiMessageList } from './AiMessageList';

function protoForTab(type: TabInfo['type']): ProtocolIconType {
  if (type === 'docker' || type === 'serial' || type === 'localshell') return type;
  return 'ssh';
}

export const AgentPanel: React.FC = () => {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.agentPanelOpen);
  const toggle = useAppStore((s) => s.toggleAgentPanel);
  const ai = useAiAssistant();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { width, onResizeMouseDown } = usePanelResize({
    initialWidth: 400,
    minWidth: 320,
    maxWidth: 680,
    edge: 'left',
  });

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, ai.threadKey]);

  const targetLabel = ai.activeTab ? ai.activeTab.title : t('ai_context_global');

  const quickPrompts = ai.activeTab
    ? [
        { icon: AlertTriangle, text: t('ai_quick_explain_output') },
        { icon: Activity, text: t('ai_quick_check_resources') },
        { icon: Network, text: t('ai_quick_check_ports') },
        { icon: Terminal, text: t('ai_quick_write_cmd') },
      ]
    : [
        { icon: Terminal, text: t('ai_quick_write_cmd') },
        { icon: Activity, text: t('ai_quick_linux_tips') },
        { icon: Sparkles, text: t('ai_quick_docker_tips') },
      ];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!ai.isAnyStreaming && ai.draft.trim()) {
        void ai.sendMessage();
      }
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="sftp-resize-handle" onMouseDown={onResizeMouseDown} />
      <aside className="agent-panel" aria-label={t('agent_panel_title')} style={{ width }}>
        {/* Header: Mode switcher + Actions */}
        <div className="agent-panel-header">
          <div className="ai-mode-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={ai.mode === 'chat'}
              className={`ai-mode-tab${ai.mode === 'chat' ? ' is-active' : ''}`}
              onClick={() => ai.setMode('chat')}
            >
              <MessageSquare size={12} />
              <span>{t('ai_mode_chat')}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={ai.mode === 'agent'}
              className={`ai-mode-tab${ai.mode === 'agent' ? ' is-active' : ''}`}
              onClick={() => ai.setMode('agent')}
            >
              <Sparkles size={12} />
              <span>{t('ai_mode_agent')}</span>
            </button>
          </div>

          <div className="agent-panel-header-actions">
            <button
              type="button"
              className="agent-panel-icon-btn"
              onClick={ai.clearConversation}
              title={t('ai_new_chat')}
              disabled={ai.messages.length === 0 && !ai.isBusyHere}
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              className="agent-panel-icon-btn"
              onClick={ai.openAiSettings}
              title={t('ai_open_settings')}
            >
              <Settings size={14} />
            </button>
            <button
              type="button"
              className="agent-panel-icon-btn"
              onClick={toggle}
              title={t('agent_panel_close')}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Context & Model Status Strip */}
        <div className="ai-context-strip">
          <button
            type="button"
            className={`ai-model-pill${ai.modelReady ? ' is-ready' : ' is-missing'}`}
            onClick={ai.openAiSettings}
            title={ai.modelMeta}
          >
            <span className="ai-status-dot" />
            <span className="ai-model-pill-text">{ai.modelLabel}</span>
          </button>

          <span className="ai-target-pill" title={targetLabel}>
            {ai.activeTab ? (
              <ProtocolIcon type={protoForTab(ai.activeTab.type)} size={12} />
            ) : (
              <TerminalSquare size={11} />
            )}
            <span>{targetLabel}</span>
          </span>

          {ai.activeTab && (
            <button
              type="button"
              className={`ai-ctx-toggle${ai.includeContext ? ' is-on' : ''}`}
              onClick={() => ai.setIncludeContext(!ai.includeContext)}
              title={t('ai_context_toggle_tip')}
            >
              <Paperclip size={11} />
              <span>
                {ai.includeContext
                  ? ai.selectionChars > 0
                    ? t('ai_ctx_selected', { count: ai.selectionChars })
                    : ai.outputKb > 0
                      ? t('ai_ctx_output', { kb: ai.outputKb })
                      : t('ai_ctx_on')
                  : t('ai_ctx_off')}
              </span>
            </button>
          )}
        </div>

        {/* Conversation Body */}
        <div className="ai-body">
          {ai.settingsLoaded && !ai.modelReady && ai.messages.length === 0 ? (
            <div className="ai-onboarding">
              <div className="ai-onboarding-icon">
                <Bot size={26} />
              </div>
              <h3>{t('ai_setup_title')}</h3>
              <p>{t('ai_setup_desc')}</p>
              <button
                type="button"
                className="settings-btn-primary ai-onboarding-cta"
                onClick={ai.openAiSettings}
              >
                <Settings size={14} />
                <span>{t('ai_setup_cta')}</span>
              </button>
            </div>
          ) : ai.messages.length === 0 ? (
            <div className="ai-welcome">
              <div className="ai-welcome-badge">
                {ai.mode === 'agent' ? <Sparkles size={20} /> : <Bot size={20} />}
              </div>
              <h3>
                {ai.mode === 'agent' ? t('ai_welcome_agent_title') : t('ai_welcome_chat_title')}
              </h3>
              <p>{ai.mode === 'agent' ? t('ai_welcome_agent_desc') : t('ai_welcome_chat_desc')}</p>
              <div className="ai-quick-grid">
                {quickPrompts.map(({ icon: Icon, text }) => (
                  <button
                    type="button"
                    key={text}
                    className="ai-quick-chip"
                    disabled={ai.isAnyStreaming}
                    onClick={() => void ai.sendMessage(text)}
                  >
                    <span className="ai-quick-chip-icon">
                      <Icon size={13} />
                    </span>
                    <span>{text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <AiMessageList
              messages={ai.messages}
              streamingPhase={ai.streamingPhase}
              hasActiveTerminal={Boolean(ai.activeTab)}
              canExecSsh={ai.canExecSsh}
              isBusy={ai.isAnyStreaming}
              runningCommand={ai.runningCommand}
              onRunCommand={(cmd, risk) => void ai.runCommandInTerminal(cmd, risk)}
              onInsertCommand={ai.insertCommandToTerminal}
              onRunAndAnalyze={(cmd, risk) => void ai.runAndAnalyzeSsh(cmd, risk)}
              onRetry={() => void ai.retryLast()}
              onOpenSettings={ai.openAiSettings}
            />
          )}
        </div>

        {/* Composer */}
        <div className="ai-composer">
          <div className="ai-composer-box">
            <textarea
              ref={inputRef}
              className="ai-composer-input"
              rows={2}
              value={ai.draft}
              onChange={(e) => ai.setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                ai.mode === 'agent'
                  ? t('ai_composer_placeholder_agent')
                  : t('ai_composer_placeholder_chat')
              }
            />
            <div className="ai-composer-footer">
              <span className="ai-composer-hint">
                {ai.cwd ? ai.cwd : t('ai_composer_shortcut')}
              </span>
              {ai.isBusyHere ? (
                <button
                  type="button"
                  className="ai-send-btn ai-send-btn--stop"
                  onClick={ai.stopStreaming}
                  title={t('ai_stop')}
                >
                  <Square size={12} />
                  <span>{t('ai_stop')}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="ai-send-btn"
                  disabled={!ai.draft.trim() || ai.isAnyStreaming}
                  onClick={() => void ai.sendMessage()}
                  title={t('ai_send')}
                >
                  <SendHorizontal size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
