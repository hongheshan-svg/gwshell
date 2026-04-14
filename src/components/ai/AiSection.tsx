import { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from './ui/sonner';
import './styles/ai.css';
import { useAppStore } from '../../stores/appStore';
import { AiProviders } from './AiProviders';
import { McpPanel } from './mcp/McpPanel';
import { SkillsPanel } from './skills/SkillsPanel';
import { AgentsPanel } from './agents/AgentsPanel';
import { UsageDashboard } from './usage/UsageDashboard';
import { SettingsPanel } from './settings/SettingsPanel';
import { ProxyPanel } from './proxy/ProxyPanel';
import { WorkspacePanel } from './workspace/WorkspacePanel';
import { AuthPanel } from './auth/AuthPanel';
import { PromptsPanel } from './prompts/PromptsPanel';
import { SessionsPanel } from './sessions/SessionsPanel';
import { AiToolbar, type AiView } from './AiToolbar';
import type { AppId } from './lib/api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const STORAGE_KEY = 'gwshell-ai-last-app';

const getInitialApp = (): AppId => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as AppId | null;
    if (saved && ['claude', 'codex', 'gemini', 'opencode', 'openclaw'].includes(saved)) {
      return saved;
    }
  } catch {}
  return 'claude';
};

export function AiSection() {
  const theme = useAppStore((s) => s.theme);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<AiView>('providers');
  const [activeApp, setActiveApp] = useState<AppId>(getInitialApp);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const handleAppChange = (app: AppId) => {
    localStorage.setItem(STORAGE_KEY, app);
    setActiveApp(app);
  };

  const renderContent = () => {
    switch (view) {
      case 'providers':
        return (
          <AiProviders
            activeApp={activeApp}
            onActiveAppChange={handleAppChange}
            addOpen={addOpen}
            onAddOpenChange={setAddOpen}
          />
        );
      case 'mcp':
        return <McpPanel onBack={() => setView('providers')} />;
      case 'skills':
        return <SkillsPanel />;
      case 'agents':
        return <AgentsPanel />;
      case 'usage':
        return <UsageDashboard />;
      case 'proxy':
        return <ProxyPanel />;
      case 'workspace':
        return <WorkspacePanel />;
      case 'prompts':
        return <PromptsPanel />;
      case 'auth':
        return <AuthPanel />;
      case 'sessions':
        return <SessionsPanel />;
      case 'settings':
        return <SettingsPanel />;
    }
  };

  return (
    <QueryClientProvider client={queryClient}>
      <div ref={rootRef} className={`ai-scope ${theme === 'dark' ? 'dark' : ''} h-full flex flex-col`}>
        <AiToolbar
          activeView={view}
          activeApp={activeApp}
          onViewChange={setView}
          onAppChange={handleAppChange}
          onAdd={() => setAddOpen(true)}
        />
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {renderContent()}
        </div>
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}

export default AiSection;
