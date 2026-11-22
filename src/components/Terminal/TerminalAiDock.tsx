import React from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';

/**
 * Compact floating launcher pill in the bottom-right corner of active terminal tabs.
 * Opens the unified right-hand AI Assistant panel (hidden while the panel is open).
 */
export const TerminalAiDock: React.FC = () => {
  const { t } = useTranslation();
  const agentPanelOpen = useAppStore((s) => s.agentPanelOpen);
  const toggleAgentPanel = useAppStore((s) => s.toggleAgentPanel);
  const activeTab = useAppStore((s) =>
    s.tabs.find((tab) => tab.id === s.activeTabId && tab.type !== 'asset-list'),
  );

  if (!activeTab || agentPanelOpen) return null;

  return (
    <button
      className="terminal-ai-fab"
      onClick={toggleAgentPanel}
      title={t('terminal_ai_open')}
      type="button"
    >
      <Sparkles size={13} />
      <span>AI</span>
    </button>
  );
};
