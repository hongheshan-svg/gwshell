import type { TranslationKeys } from '../i18n';
import { useAppStore } from '../stores/appStore';
import { IS_MACOS } from '../lib/platform';

export interface KeyAction { id: string; labelKey: TranslationKeys; defaultBinding: string; run: () => void }

function cycleTab(dir: 1 | -1): void {
  const { tabs, activeTabId, setActiveTab } = useAppStore.getState();
  const term = tabs.filter((t) => t.type !== 'asset-list');
  if (term.length === 0) return;
  const cur = term.findIndex((t) => t.id === activeTabId);
  const next = cur < 0 ? 0 : (cur + dir + term.length) % term.length;
  setActiveTab(term[next].id);
}

export const KEY_ACTIONS: KeyAction[] = [
  { id: 'broadcast.toggle', labelKey: 'action_broadcast_toggle', defaultBinding: 'Ctrl+Shift+B', run: () => useAppStore.getState().toggleBroadcastInput() },
  { id: 'palette.open', labelKey: 'action_palette_open', defaultBinding: IS_MACOS ? 'Meta+K' : 'Ctrl+K', run: () => useAppStore.getState().setShowCommandPalette(true) },
  { id: 'tab.next', labelKey: 'action_tab_next', defaultBinding: 'Ctrl+Tab', run: () => cycleTab(1) },
  { id: 'tab.prev', labelKey: 'action_tab_prev', defaultBinding: 'Ctrl+Shift+Tab', run: () => cycleTab(-1) },
  {
    id: 'tab.close',
    labelKey: 'action_tab_close',
    defaultBinding: 'Ctrl+Shift+W',
    run: () => {
      const { activeTabId, tabs, removeTab } = useAppStore.getState();
      if (!activeTabId) return;
      const tab = tabs.find((t) => t.id === activeTabId);
      // Destroy the xterm instance + backend listeners before removing the tab,
      // matching the TabBar close-button path. Skip for the asset-list pseudo-tab
      // which never has a terminal instance.
      if (tab && tab.type !== 'asset-list') {
        import('../components/Terminal/TerminalView').then(({ destroyTerminal }) => {
          destroyTerminal(activeTabId);
        });
      }
      removeTab(activeTabId);
    },
  },
  { id: 'settings.open', labelKey: 'action_settings_open', defaultBinding: 'Ctrl+Comma', run: () => useAppStore.getState().setShowSettings(true) },
  { id: 'terminal.search', labelKey: 'action_terminal_search', defaultBinding: 'Ctrl+Shift+H', run: () => useAppStore.getState().setShowTerminalSearch(true) },
];

export const ACTION_BY_ID = new Map(KEY_ACTIONS.map((a) => [a.id, a]));
