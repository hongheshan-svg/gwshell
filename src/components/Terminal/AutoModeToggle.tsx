import React from 'react';
import { Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAutoModeStore } from '../../stores/autoModeStore';

interface AutoModeToggleProps {
  tabId: string;
}

export const AutoModeToggle: React.FC<AutoModeToggleProps> = ({ tabId }) => {
  const enabled = useAutoModeStore((s) => !!s.enabled[tabId]);
  const count = useAutoModeStore((s) => s.counters[tabId] ?? 0);
  const toggle = useAutoModeStore((s) => s.toggle);
  const { t } = useTranslation();

  const title = enabled ? t('auto_mode_toggle_on', { count }) : t('auto_mode_toggle_off');

  return (
    <button
      className={`auto-mode-toggle ${enabled ? 'on' : 'off'}`}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        toggle(tabId);
      }}
    >
      <Zap size={11} />
    </button>
  );
};
