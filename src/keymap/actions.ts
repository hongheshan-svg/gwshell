import i18n, { type TranslationKeys } from '../i18n';
import { destroyTerminal } from '../lib/terminalLifecycle';
import { useAppStore } from '../stores/appStore';
import { useConfirmStore } from '../stores/confirmStore';
import { useSettingsStore } from '../stores/settingsStore';
import { IS_MACOS } from '../lib/platform';

export interface KeyAction {
  id: string;
  labelKey: TranslationKeys;
  defaultBinding: string;
  run: () => void;
}

function cycleTab(dir: 1 | -1): void {
  const { tabs, activeTabId, setActiveTab } = useAppStore.getState();
  const term = tabs.filter((t) => t.type !== 'asset-list');
  if (term.length === 0) return;
  const cur = term.findIndex((t) => t.id === activeTabId);
  const next = cur < 0 ? 0 : (cur + dir + term.length) % term.length;
  setActiveTab(term[next].id);
}

export const KEY_ACTIONS: KeyAction[] = [
  {
    id: 'broadcast.toggle',
    labelKey: 'action_broadcast_toggle',
    defaultBinding: 'Ctrl+Shift+B',
    run: () => useAppStore.getState().toggleBroadcastInput(),
  },
  {
    id: 'palette.open',
    labelKey: 'action_palette_open',
    defaultBinding: IS_MACOS ? 'Meta+K' : 'Ctrl+K',
    run: () => useAppStore.getState().setShowCommandPalette(true),
  },
  {
    id: 'tab.next',
    labelKey: 'action_tab_next',
    defaultBinding: 'Ctrl+Tab',
    run: () => cycleTab(1),
  },
  {
    id: 'tab.prev',
    labelKey: 'action_tab_prev',
    defaultBinding: 'Ctrl+Shift+Tab',
    run: () => cycleTab(-1),
  },
  {
    id: 'tab.close',
    labelKey: 'action_tab_close',
    defaultBinding: 'Ctrl+Shift+W',
    run: () => {
      const { activeTabId, tabs, removeTab } = useAppStore.getState();
      if (!activeTabId) return;
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || tab.type === 'asset-list') return;
      const doClose = () => {
        destroyTerminal(activeTabId);
        removeTab(activeTabId);
      };
      const { tabCloseConfirm } = useSettingsStore.getState().settings;
      if (tabCloseConfirm && tab.connected) {
        void useConfirmStore
          .getState()
          .request({
            title: i18n.t('tab_close_confirm_btn'),
            message: i18n.t('tab_close_confirm_msg'),
            confirmLabel: i18n.t('tab_close_confirm_btn'),
            danger: true,
          })
          .then((ok) => {
            if (ok) doClose();
          });
        return;
      }
      doClose();
    },
  },
  {
    id: 'settings.open',
    labelKey: 'action_settings_open',
    defaultBinding: 'Ctrl+Comma',
    run: () => useAppStore.getState().setShowSettings(true),
  },
  {
    id: 'agent.toggle',
    labelKey: 'settings_sc_agent',
    defaultBinding: 'Ctrl+Shift+A',
    run: () => useAppStore.getState().toggleAgentPanel(),
  },
  {
    id: 'terminal.search',
    labelKey: 'action_terminal_search',
    defaultBinding: 'Ctrl+Shift+H',
    run: () => {
      const { activeTabId, tabs, setShowTerminalSearch } = useAppStore.getState();
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || tab.type === 'asset-list') return;
      setShowTerminalSearch(true);
    },
  },
];

export const ACTION_BY_ID = new Map(KEY_ACTIONS.map((a) => [a.id, a]));
