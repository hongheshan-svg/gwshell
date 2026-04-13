import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './styles/ai.css';
import { useAppStore } from '../../stores/appStore';
import { AiProviders } from './AiProviders';
import { McpPanel } from './mcp/McpPanel';
import { SkillsPanel } from './skills/SkillsPanel';
import { AgentsPanel } from './agents/AgentsPanel';
import { UsageDashboard } from './usage/UsageDashboard';

type AiView = 'providers' | 'mcp' | 'skills' | 'agents' | 'usage';

const TABS: { id: AiView; labelKey: string; defaultLabel: string }[] = [
  { id: 'providers', labelKey: 'nav.providers', defaultLabel: '供应商' },
  { id: 'mcp', labelKey: 'nav.mcp', defaultLabel: 'MCP' },
  { id: 'skills', labelKey: 'nav.skills', defaultLabel: 'Skills' },
  { id: 'agents', labelKey: 'nav.agents', defaultLabel: 'Agents' },
  { id: 'usage', labelKey: 'nav.usage', defaultLabel: 'Usage' },
];

export function AiSection() {
  const theme = useAppStore((s) => s.theme);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<AiView>('providers');
  const { t } = useTranslation('ai');

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const renderContent = () => {
    switch (view) {
      case 'providers':
        return <AiProviders />;
      case 'mcp':
        return <McpPanel onBack={() => setView('providers')} />;
      case 'skills':
        return <SkillsPanel />;
      case 'agents':
        return <AgentsPanel />;
      case 'usage':
        return <UsageDashboard />;
    }
  };

  return (
    <div ref={rootRef} className={`ai-scope ${theme === 'dark' ? 'dark' : ''} h-full flex flex-col`}>
      {/* Tab bar */}
      <div className="flex-shrink-0 border-b border-border flex items-center px-6 gap-1 h-10">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setView(tab.id)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              view === tab.id
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            {t(tab.labelKey, { defaultValue: tab.defaultLabel })}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {renderContent()}
      </div>
    </div>
  );
}

export default AiSection;
