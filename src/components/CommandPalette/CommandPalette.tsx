import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { buildCommands, type Command } from './commands';

const GROUPS: Array<Command['group']> = ['action', 'create', 'session', 'tab'];

const GROUP_LABELS: Record<Command['group'], [string, string]> = {
  action:  ['cmd_grp_action',  'Commands'],
  create:  ['cmd_grp_create',  'Create'],
  session: ['cmd_grp_session', 'Sessions'],
  tab:     ['cmd_grp_tab',     'Tabs'],
};

export const CommandPalette: React.FC = () => {
  const { t } = useTranslation('gwshell');

  const {
    sessions,
    tabs,
    addTab,
    setActiveTab,
    setShowNewSession,
    setShowQuickConnect,
    setShowLocalTerminalModal,
    setShowSettings,
    toggleSidebar,
    toggleTheme,
    setShowCommandPalette,
  } = useAppStore();

  const { settings } = useSettingsStore();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const ctx = useMemo(() => ({
    sessions,
    tabs,
    keymapOverrides: settings.keymapOverrides ?? {},
    t: (k: string, d?: string) => t(k, d ?? k),
    addTab,
    setActiveTab,
    setShowNewSession,
    setShowQuickConnect,
    setShowLocalTerminalModal,
    setShowSettings,
    toggleSidebar,
    toggleTheme,
  }), [
    sessions,
    tabs,
    settings.keymapOverrides,
    t,
    addTab,
    setActiveTab,
    setShowNewSession,
    setShowQuickConnect,
    setShowLocalTerminalModal,
    setShowSettings,
    toggleSidebar,
    toggleTheme,
  ]);

  const commands = useMemo(() => buildCommands(ctx), [ctx]);

  // Filter across label + sub + keywords (case-insensitive)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) => {
      const haystack = [cmd.label, cmd.sub ?? '', cmd.keywords ?? ''].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [query, commands]);

  // Build grouped structure: groups in fixed order, only non-empty
  const grouped = useMemo(() => {
    return GROUPS.flatMap((group) => {
      const items = filtered.filter((cmd) => cmd.group === group);
      if (items.length === 0) return [];
      return [{ group, items }];
    });
  }, [filtered]);

  // Flat list of visible items for keyboard navigation
  const flatItems = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  // Reset to 0 when query changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view when activeIndex changes
  useEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const close = useCallback(() => {
    setShowCommandPalette(false);
  }, [setShowCommandPalette]);

  const runCommand = useCallback((cmd: Command) => {
    setShowCommandPalette(false);
    cmd.run();
  }, [setShowCommandPalette]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = flatItems[activeIndex];
      if (cmd) runCommand(cmd);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  // Reset itemRefs array length each render
  itemRefs.current = [];

  return (
    <div className="command-palette-overlay" onMouseDown={close}>
      <div
        className="command-palette-card"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="command-palette-input"
          placeholder={t('palette_placeholder', 'Search commands…')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
        />
        <div className="command-palette-list" ref={listRef}>
          {flatItems.length === 0 && (
            <div className="command-palette-empty">{t('palette_no_results', 'No results')}</div>
          )}
          {grouped.map(({ group, items }) => {
            const [labelKey, fallback] = GROUP_LABELS[group];
            return (
              <div key={group} className="command-palette-group">
                <div className="command-palette-group-title">{t(labelKey, fallback)}</div>
                {items.map((cmd) => {
                  const flatIdx = flatItems.indexOf(cmd);
                  const isActive = flatIdx === activeIndex;
                  const Icon = cmd.icon;
                  return (
                    <div
                      key={cmd.id}
                      ref={(el) => { itemRefs.current[flatIdx] = el; }}
                      className={`command-palette-item${isActive ? ' active' : ''}`}
                      onMouseEnter={() => setActiveIndex(flatIdx)}
                      onClick={() => runCommand(cmd)}
                    >
                      {Icon && <Icon size={14} className="command-palette-item-icon" />}
                      <span className="command-palette-item-label">{cmd.label}</span>
                      {cmd.sub && (
                        <span className="command-palette-item-sub">{cmd.sub}</span>
                      )}
                      {cmd.hint && (
                        <kbd className="command-palette-item-hint">{cmd.hint}</kbd>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
