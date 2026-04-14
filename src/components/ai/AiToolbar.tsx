// src/components/ai/AiToolbar.tsx
import { Plus, Plug, Zap, Bot, BarChart2, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './lib/utils';
import type { AppId } from './lib/api';
import { ProviderIcon } from './providers/ProviderIcon';

export type AiView =
  | 'providers'
  | 'mcp'
  | 'skills'
  | 'agents'
  | 'usage'
  | 'proxy'
  | 'workspace'
  | 'prompts'
  | 'auth'
  | 'sessions'
  | 'settings';

interface AiToolbarProps {
  activeView: AiView;
  activeApp: AppId;
  onViewChange: (view: AiView) => void;
  onAppChange: (app: AppId) => void;
  onAdd: () => void;
}

const APPS: { id: AppId; icon: string; label: string }[] = [
  { id: 'claude', icon: 'claude', label: 'Claude' },
  { id: 'codex', icon: 'openai', label: 'Codex' },
  { id: 'gemini', icon: 'gemini', label: 'Gemini' },
  { id: 'opencode', icon: 'opencode', label: 'OpenCode' },
  { id: 'openclaw', icon: 'openclaw', label: 'OpenClaw' },
];

const ACTION_VIEWS: { id: AiView; icon: ReactNode; label: string }[] = [
  { id: 'mcp', icon: <Plug className="h-4 w-4" />, label: 'MCP' },
  { id: 'skills', icon: <Zap className="h-4 w-4" />, label: 'Skills' },
  { id: 'agents', icon: <Bot className="h-4 w-4" />, label: 'Agents' },
  { id: 'usage', icon: <BarChart2 className="h-4 w-4" />, label: 'Usage' },
];

export function AiToolbar({
  activeView,
  activeApp,
  onViewChange,
  onAppChange,
  onAdd,
}: AiToolbarProps) {
  const isProvidersActive = activeView === 'providers';

  return (
    <div className="flex-shrink-0 border-b border-border flex items-center px-3 gap-2 h-12">
      {/* App switcher — left pill group */}
      <div className="flex items-center bg-muted rounded-full p-1 gap-0.5">
        {APPS.map((app) => (
          <button
            key={app.id}
            type="button"
            title={app.label}
            onClick={() => {
              onAppChange(app.id);
              onViewChange('providers');
            }}
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150',
              isProvidersActive && activeApp === app.id
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
          >
            <ProviderIcon icon={app.icon} name={app.label} size={18} />
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {/* Action icons — right pill group */}
      <div className="flex items-center bg-muted rounded-full p-1 gap-0.5">
        {ACTION_VIEWS.map((action) => (
          <button
            key={action.id}
            type="button"
            title={action.label}
            onClick={() => onViewChange(action.id)}
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150',
              activeView === action.id
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
          >
            {action.icon}
          </button>
        ))}
      </div>

      {/* Settings gear */}
      <button
        type="button"
        title="Settings"
        onClick={() => onViewChange('settings')}
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150',
          activeView === 'settings'
            ? 'bg-background shadow-sm text-foreground'
            : 'bg-muted text-muted-foreground hover:bg-background/60 hover:text-foreground',
        )}
      >
        <Settings className="h-4 w-4" />
      </button>

      {/* Add button */}
      <button
        type="button"
        title="Add Provider"
        onClick={onAdd}
        className="w-8 h-8 rounded-full bg-orange-500 hover:bg-orange-600 flex items-center justify-center text-white transition-colors flex-shrink-0"
      >
        <Plus className="h-5 w-5" />
      </button>
    </div>
  );
}
