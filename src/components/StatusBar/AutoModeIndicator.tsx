import React from 'react';
import { Zap, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAutoModeStore } from '../../stores/autoModeStore';
import { useAppStore } from '../../stores/appStore';

export const AutoModeIndicator: React.FC = () => {
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const enabled = useAutoModeStore((s) => (activeTabId ? !!s.enabled[activeTabId] : false));
  const count = useAutoModeStore((s) => (activeTabId ? s.counters[activeTabId] ?? 0 : 0));
  const toggleLogPanel = useAutoModeStore((s) => s.toggleLogPanel);
  const { t } = useTranslation();

  if (!activeTabId) return null;
  const activeTab = tabs.find((tb) => tb.id === activeTabId);
  if (!activeTab || (activeTab.type !== 'ssh' && activeTab.type !== 'localshell')) return null;
  if (!enabled) return null;

  return (
    <div
      className="auto-mode-indicator"
      onClick={() => activeTabId && toggleLogPanel(activeTabId)}
      title={t('auto_mode_status_badge', { count })}
    >
      <Zap size={10} />
      <span>Auto · {count}</span>
      <ChevronDown size={10} />
    </div>
  );
};
