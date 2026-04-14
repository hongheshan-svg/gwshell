# AI Section CC Switch Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the AI section navigation to match CC Switch's icon-only toolbar, with circular provider avatars and no gradient overlays.

**Architecture:** Extract a new `AiToolbar` component that owns the single-row toolbar (app icon pills left, action icon pills right, settings gear, orange + button). Lift `activeApp` and `addOpen` state from `AiProviders` up to `AiSection` so the toolbar can control them. Modify `ProviderCard` to use a circle avatar and remove the gradient overlay.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, lucide-react, @tauri-apps/api

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/components/ai/AiToolbar.tsx` | Single-row toolbar: app switcher pills + action icon pills + settings gear + add button |
| Modify | `src/components/ai/AiSection.tsx` | Replace tab bar with `<AiToolbar>`; lift `activeApp` + `addOpen` state here |
| Modify | `src/components/ai/AiProviders.tsx` | Accept `activeApp`, `onActiveAppChange`, `addOpen`, `onAddOpenChange` as props; remove internal state + AppSwitcher + bottom bar |
| Modify | `src/components/ai/providers/ProviderCard.tsx` | Avatar → `rounded-full`; remove gradient overlay div |

---

### Task 1: Create `AiToolbar` component

**Files:**
- Create: `src/components/ai/AiToolbar.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/ai/AiToolbar.tsx
import { Plus, Plug, Zap, Bot, BarChart2, Settings } from 'lucide-react';
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

const ACTION_VIEWS: { id: AiView; icon: React.ReactNode; label: string }[] = [
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
          'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 bg-muted',
          activeView === 'settings'
            ? 'bg-background shadow-sm text-foreground'
            : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd D:/toolsource/gwshell && npm run build 2>&1 | head -30
```

Expected: only unrelated errors (if any); no errors from `AiToolbar.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/AiToolbar.tsx
git commit -m "feat: add AiToolbar component — icon-only app switcher + action icons"
```

---

### Task 2: Update `AiSection.tsx` — replace tab bar with toolbar

**Files:**
- Modify: `src/components/ai/AiSection.tsx`

The tab bar (`<div className="flex-shrink-0 border-b ...">`) and `TABS` array are replaced by `<AiToolbar>`. `activeApp` and `addOpen` state are lifted here from `AiProviders`.

- [ ] **Step 1: Rewrite `AiSection.tsx`**

```tsx
// src/components/ai/AiSection.tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd D:/toolsource/gwshell && npm run build 2>&1 | head -40
```

Expected: TypeScript errors about `AiProviders` missing the new props — that's expected and will be fixed in Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/AiSection.tsx
git commit -m "feat: replace AiSection tab bar with AiToolbar"
```

---

### Task 3: Update `AiProviders.tsx` — accept props, remove internal state + AppSwitcher + bottom bar

**Files:**
- Modify: `src/components/ai/AiProviders.tsx`

Remove: `activeApp` state, `addOpen` state, `STORAGE_KEY`, `getInitialApp`, AppSwitcher JSX, universal-mode button, universal header, bottom add-bar div.  
Add: `AiProvidersProps` interface with `activeApp`, `onActiveAppChange`, `addOpen`, `onAddOpenChange`.

- [ ] **Step 1: Rewrite `AiProviders.tsx`**

```tsx
// src/components/ai/AiProviders.tsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { ProviderList } from './providers/ProviderList';
import { AddProviderDialog } from './providers/AddProviderDialog';
import { EditProviderDialog } from './providers/EditProviderDialog';
import { providersApi, activeIdsToRecord, type AiProvider, type AppId } from './lib/api';
import { ConfirmDialog } from './ConfirmDialog';

interface ProviderHealthDto {
  providerId: string;
  status: string;
  latencyMs?: number;
  httpStatus?: number;
  checkMode: string;
  target: string;
  message: string;
  checkedAt: number;
}

interface AiProvidersProps {
  activeApp: AppId;
  onActiveAppChange: (app: AppId) => void;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}

const ALL_APPS: AppId[] = ['claude', 'codex', 'gemini', 'opencode', 'openclaw'];

export function AiProviders({
  activeApp,
  onActiveAppChange: _onActiveAppChange,
  addOpen,
  onAddOpenChange,
}: AiProvidersProps) {
  const { t } = useTranslation('ai');

  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [activeIds, setActiveIds] = useState<Record<AppId, string | undefined>>({
    claude: undefined,
    codex: undefined,
    gemini: undefined,
    opencode: undefined,
    openclaw: undefined,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [editProvider, setEditProvider] = useState<AiProvider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiProvider | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [healthResults, setHealthResults] = useState<Record<string, ProviderHealthDto>>({});

  const loadProviders = useCallback(async () => {
    try {
      const [all, ids] = await Promise.all([
        providersApi.list(),
        providersApi.getActiveIds(),
      ]);
      setProviders(all);
      setActiveIds(activeIdsToRecord(ids));
    } catch (err) {
      console.error('[AiProviders] load failed', err);
      toast.error(t('provider.loadFailed', { defaultValue: '加载供应商失败' }));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const appProviders = useMemo(
    () => providers.filter((p) => p.apps[activeApp]),
    [providers, activeApp],
  );

  const currentProviderId = activeIds[activeApp] ?? '';

  const handleSwitch = useCallback(
    async (provider: AiProvider) => {
      try {
        await providersApi.switch(provider.id, activeApp);
        setActiveIds((prev) => ({ ...prev, [activeApp]: provider.id }));
        toast.success(
          t('provider.switchSuccess', {
            name: provider.name,
            defaultValue: `已切换到 ${provider.name}`,
          }),
        );
      } catch (err) {
        console.error('[AiProviders] switch failed', err);
        toast.error(t('provider.switchFailed', { defaultValue: '切换供应商失败' }));
      }
    },
    [activeApp, t],
  );

  const handleAdd = useCallback(
    async (providerData: Omit<AiProvider, 'id'> & { providerKey?: string }) => {
      try {
        const baseId = providerData.providerKey?.trim() || crypto.randomUUID().slice(0, 8);
        const baseApps: AiProvider['apps'] = Object.assign(
          { claude: false, codex: false, gemini: false, opencode: false, openclaw: false },
          providerData.apps,
          { [activeApp]: true },
        );
        const newProvider: AiProvider = { ...providerData, id: baseId, apps: baseApps };
        await providersApi.save(newProvider);
        await loadProviders();
        toast.success(t('provider.addSuccess', { defaultValue: '供应商添加成功' }));
      } catch (err) {
        console.error('[AiProviders] add failed', err);
        throw err;
      }
    },
    [activeApp, loadProviders, t],
  );

  const handleEdit = useCallback(
    async (payload: { provider: AiProvider; originalId?: string }) => {
      try {
        if (payload.originalId && payload.originalId !== payload.provider.id) {
          await providersApi.delete(payload.originalId);
        }
        await providersApi.save(payload.provider);
        await loadProviders();
        toast.success(t('provider.saveSuccess', { defaultValue: '供应商保存成功' }));
      } catch (err) {
        console.error('[AiProviders] edit failed', err);
        toast.error(t('provider.saveFailed', { defaultValue: '供应商保存失败' }));
      }
    },
    [loadProviders, t],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await providersApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      await loadProviders();
      toast.success(t('provider.deleteSuccess', { defaultValue: '供应商已删除' }));
    } catch (err) {
      console.error('[AiProviders] delete failed', err);
      toast.error(t('provider.deleteFailed', { defaultValue: '删除供应商失败' }));
    }
  }, [deleteTarget, loadProviders, t]);

  const handleDuplicate = useCallback(
    async (provider: AiProvider) => {
      try {
        const copy: AiProvider = {
          ...provider,
          id: crypto.randomUUID().slice(0, 8),
          name: `${provider.name} (Copy)`,
          createdAt: Date.now(),
        };
        await providersApi.save(copy);
        await loadProviders();
        toast.success(t('provider.duplicateSuccess', { defaultValue: '供应商已复制' }));
      } catch (err) {
        console.error('[AiProviders] duplicate failed', err);
        toast.error(t('provider.duplicateFailed', { defaultValue: '复制供应商失败' }));
      }
    },
    [loadProviders, t],
  );

  const handleTest = useCallback(
    async (provider: AiProvider) => {
      if (testingId) return;
      setTestingId(provider.id);
      try {
        const result = await invoke<ProviderHealthDto>('ai_platform_check_provider_health', {
          providerId: provider.id,
        });
        setHealthResults((prev) => ({ ...prev, [provider.id]: result }));
        if (result.status === 'ok') {
          toast.success(
            t('provider.testOk', {
              name: provider.name,
              ms: result.latencyMs ?? 0,
              defaultValue: `${provider.name} 响应正常 (${result.latencyMs ?? 0}ms)`,
            }),
            { closeButton: true },
          );
        } else {
          toast.error(
            t('provider.testFail', {
              name: provider.name,
              msg: result.message,
              defaultValue: `${provider.name} 测试失败: ${result.message}`,
            }),
          );
        }
      } catch (err) {
        toast.error(String(err));
      } finally {
        setTestingId(null);
      }
    },
    [testingId, t],
  );

  const handleOpenWebsite = useCallback((url: string) => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const handleEnableAllApps = useCallback(
    async (provider: AiProvider) => {
      const updated: AiProvider = {
        ...provider,
        apps: { claude: true, codex: true, gemini: true, opencode: true, openclaw: true },
      };
      try {
        await providersApi.save(updated);
        await loadProviders();
        toast.success(
          t('provider.enabledAllApps', {
            name: provider.name,
            defaultValue: `${provider.name} 已启用所有应用`,
          }),
        );
      } catch (err) {
        toast.error(String(err));
      }
    },
    [loadProviders, t],
  );

  return (
    <div className="flex flex-col h-full ai-scope">
      <div className="flex-1 min-h-0 overflow-hidden">
        <ProviderList
          providers={appProviders}
          currentProviderId={currentProviderId}
          appId={activeApp}
          onSwitch={handleSwitch}
          onEdit={(p: AiProvider) => setEditProvider(p)}
          onDelete={(p: AiProvider) => setDeleteTarget(p)}
          onDuplicate={handleDuplicate}
          onOpenWebsite={handleOpenWebsite}
          onCreate={() => onAddOpenChange(true)}
          onTest={handleTest}
          isLoading={isLoading}
          testingProviderId={testingId ?? undefined}
          healthResults={healthResults}
        />
      </div>

      <AddProviderDialog
        open={addOpen}
        onOpenChange={onAddOpenChange}
        appId={activeApp}
        onSubmit={handleAdd}
      />

      <EditProviderDialog
        open={editProvider !== null}
        provider={editProvider}
        onOpenChange={(open: boolean) => { if (!open) setEditProvider(null); }}
        onSubmit={handleEdit}
        appId={activeApp}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t('provider.deleteConfirmTitle', { defaultValue: '删除供应商' })}
        message={t('provider.deleteConfirmDesc', {
          name: deleteTarget?.name ?? '',
          defaultValue: `确定要删除供应商 "${deleteTarget?.name ?? ''}" 吗？此操作不可撤销。`,
        })}
        confirmText={t('common.delete', { defaultValue: '删除' })}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="destructive"
      />
    </div>
  );
}

export default AiProviders;
```

- [ ] **Step 2: Verify TypeScript compiles clean**

```bash
cd D:/toolsource/gwshell && npm run build 2>&1 | head -40
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/AiProviders.tsx
git commit -m "refactor: lift activeApp/addOpen to AiSection, remove bottom bar from AiProviders"
```

---

### Task 4: Update `ProviderCard.tsx` — circle avatar, no gradient

**Files:**
- Modify: `src/components/ai/providers/ProviderCard.tsx`

Two changes only:
1. Avatar container: `rounded-lg bg-muted border border-border h-8 w-8` → `rounded-full bg-muted h-9 w-9` (remove border, make circular, slightly larger)
2. Remove the gradient overlay `<div className="absolute inset-0 bg-gradient-to-r ...">` entirely

- [ ] **Step 1: Replace avatar container (line ~187)**

Find this block in `ProviderCard.tsx`:
```tsx
<div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center border border-border group-hover:scale-105 transition-transform duration-300">
  <ProviderIcon
    icon={provider.icon}
    name={provider.name}
    color={provider.iconColor}
    size={20}
  />
</div>
```

Replace with:
```tsx
<div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform duration-300">
  <ProviderIcon
    icon={provider.icon}
    name={provider.name}
    color={provider.iconColor}
    size={20}
  />
</div>
```

- [ ] **Step 2: Remove gradient overlay (lines ~159–169)**

Find and delete this entire div:
```tsx
<div
  className={cn(
    "absolute inset-0 bg-gradient-to-r to-transparent transition-opacity duration-500 pointer-events-none",
    shouldUseGreen && "from-emerald-500/10",
    (shouldUseBlue || hasPersistentConfigHighlight) && "from-blue-500/10",
    !shouldUseGreen &&
      !shouldUseBlue &&
      !hasPersistentConfigHighlight &&
      "from-primary/10",
    isActiveProvider || hasPersistentConfigHighlight
      ? "opacity-100"
      : "opacity-0",
  )}
/>
```

- [ ] **Step 3: Verify TypeScript compiles clean**

```bash
cd D:/toolsource/gwshell && npm run build 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ai/providers/ProviderCard.tsx
git commit -m "feat: circle avatar and remove gradient overlay from ProviderCard"
```

---

### Task 5: Visual verification

**Files:** none (read-only verification step)

- [ ] **Step 1: Start the dev server**

```bash
cd D:/toolsource/gwshell && npm run tauri dev
```

- [ ] **Step 2: Check toolbar**

Open the AI section. Verify:
- Top row shows 5 app icon pills on the left (Claude, Codex, Gemini, OpenCode, OpenClaw)
- Active app pill has white background + shadow
- Right side shows MCP, Skills, Agents, Usage pill group + gear icon + orange + button
- Clicking each icon switches to the correct panel
- No text tab bar visible

- [ ] **Step 3: Check provider cards**

Switch to Claude. Verify:
- Provider avatars are circular
- No gradient overlay on cards
- Active provider has blue border + light blue tint (no gradient)
- Drag handles still work

- [ ] **Step 4: Check add flow**

Click the orange `+` button. Verify the Add Provider dialog opens. Add and cancel — no errors.

- [ ] **Step 5: Commit if any follow-up tweaks were needed**

```bash
git add -p
git commit -m "fix: visual polish after CC Switch toolbar redesign"
```
