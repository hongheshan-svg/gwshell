import type { LucideIcon } from 'lucide-react';
import { Settings, Plus, Terminal, Zap, Home, Sun, PanelLeft, Search, Radio, X, ArrowLeftRight } from 'lucide-react';
import { KEY_ACTIONS } from '../../keymap/actions';
import { parseBinding, formatStep } from '../../keymap/match';
import type { SessionConfig, TabInfo } from '../../types';

export interface Command {
  id: string;
  group: 'action' | 'create' | 'session' | 'tab';
  label: string;
  sub?: string;
  hint?: string;
  keywords?: string;
  icon?: LucideIcon;
  run: () => void;
}

function fmtBinding(binding?: string): string | undefined {
  if (!binding) return undefined;
  const chord = parseBinding(binding);
  return chord ? chord.map(formatStep).join(' ') : undefined;
}

export interface CommandCtx {
  sessions: SessionConfig[];
  tabs: TabInfo[];
  keymapOverrides: Record<string, string | null>;
  t: (k: string, d?: string) => string;
  addTab: (t: TabInfo) => void;
  setActiveTab: (id: string) => void;
  setShowNewSession: (b: boolean) => void;
  setShowQuickConnect: (b: boolean) => void;
  // Note: the store exposes setShowLocalTerminalModal (not setShowLocalTerminal)
  setShowLocalTerminalModal: (b: boolean) => void;
  setShowSettings: (b: boolean) => void;
  toggleSidebar: () => void;
  toggleTheme: () => void;
}

export function buildCommands(ctx: CommandCtx): Command[] {
  const cmds: Command[] = [];

  // KEY_ACTIONS — skip palette.open itself to avoid recursion
  for (const a of KEY_ACTIONS) {
    if (a.id === 'palette.open') continue;
    const binding = ctx.keymapOverrides[a.id] ?? a.defaultBinding;
    cmds.push({
      id: `action:${a.id}`,
      group: 'action',
      label: ctx.t(a.labelKey),
      hint: fmtBinding(binding),
      icon: iconForAction(a.id),
      run: a.run,
    });
  }

  // Create / nav commands
  cmds.push(
    { id: 'create:ssh',   group: 'create', label: ctx.t('cmd_new_ssh',        'New SSH'),            icon: Plus,       run: () => ctx.setShowNewSession(true) },
    { id: 'create:local', group: 'create', label: ctx.t('cmd_new_local',      'New local terminal'), icon: Terminal,   run: () => ctx.setShowLocalTerminalModal(true) },
    { id: 'create:quick', group: 'create', label: ctx.t('cmd_quick_connect',  'Quick connect'),      icon: Zap,        run: () => ctx.setShowQuickConnect(true) },
    { id: 'nav:home',     group: 'create', label: ctx.t('cmd_open_home',      'Open home'),          icon: Home,       run: () => ctx.setActiveTab('asset-list') },
    { id: 'nav:theme',    group: 'create', label: ctx.t('cmd_toggle_theme',   'Toggle theme'),       icon: Sun,        run: ctx.toggleTheme },
    { id: 'nav:sidebar',  group: 'create', label: ctx.t('cmd_toggle_sidebar', 'Toggle sidebar'),     icon: PanelLeft,  run: ctx.toggleSidebar },
  );

  // Saved sessions (skip temporaries — they are split-screen clones, not real entries)
  for (const s of ctx.sessions) {
    if (s._temporary) continue;
    cmds.push({
      id: `session:${s.id}`,
      group: 'session',
      label: s.name,
      sub: s.host ?? s.session_type,
      keywords: `${s.host ?? ''} ${s.username ?? ''}`,
      icon: Search,
      run: () => {
        const existing = ctx.tabs.find((tb) => tb.sessionId === s.id);
        if (existing) {
          ctx.setActiveTab(existing.id);
        } else {
          ctx.addTab({
            id: crypto.randomUUID(),
            sessionId: s.id,
            title: s.name,
            type: s.session_type,
            connected: false,
          });
        }
      },
    });
  }

  // Open tabs (skip the home/asset-list pseudo-tab)
  for (const tb of ctx.tabs) {
    if (tb.type === 'asset-list') continue;
    cmds.push({
      id: `tab:${tb.id}`,
      group: 'tab',
      label: tb.title,
      sub: tb.type,
      icon: ArrowLeftRight,
      run: () => ctx.setActiveTab(tb.id),
    });
  }

  return cmds;
}

function iconForAction(id: string): LucideIcon {
  if (id.startsWith('settings'))   return Settings;
  if (id.startsWith('terminal'))   return Search;
  if (id.startsWith('broadcast'))  return Radio;
  if (id === 'tab.close')          return X;
  return ArrowLeftRight;
}
