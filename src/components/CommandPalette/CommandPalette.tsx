import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import type { SessionConfig, TabInfo } from '../../types';

type Item =
  | { kind: 'session'; session: SessionConfig; label: string; sub: string }
  | { kind: 'tab'; tab: TabInfo; label: string; sub: string };

export const CommandPalette: React.FC = () => {
  const { t } = useTranslation();
  const { sessions, tabs, addTab, setActiveTab, setShowCommandPalette } = useAppStore();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const items = useMemo<Item[]>(() => {
    const sessionItems: Item[] = sessions
      .filter((s) => !s._temporary)
      .map((s) => ({ kind: 'session' as const, session: s, label: s.name, sub: s.host ?? s.session_type }));
    const tabItems: Item[] = tabs
      .filter((tb) => tb.type !== 'asset-list')
      .map((tb) => ({ kind: 'tab' as const, tab: tb, label: tb.title, sub: tb.type }));
    const all = [...sessionItems, ...tabItems];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((it) => it.label.toLowerCase().includes(q) || it.sub.toLowerCase().includes(q));
  }, [query, sessions, tabs]);

  const close = () => setShowCommandPalette(false);

  const activate = (it: Item | undefined) => {
    if (!it) return;
    if (it.kind === 'session') {
      const existing = tabs.find((tb) => tb.sessionId === it.session.id);
      if (existing) setActiveTab(existing.id);
      else addTab({ id: crypto.randomUUID(), sessionId: it.session.id, title: it.session.name, type: it.session.session_type, connected: false });
    } else {
      setActiveTab(it.tab.id);
    }
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(items[index]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <div className="command-palette-overlay" onMouseDown={close}>
      <div className="command-palette-card" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <input
          className="command-palette-input"
          autoFocus
          placeholder={t('palette_placeholder')}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
        />
        <div className="command-palette-list">
          {items.length === 0 && <div className="command-palette-empty">{t('palette_no_results')}</div>}
          {items.map((it, i) => (
            <div
              key={it.kind === 'session' ? `s-${it.session.id}` : `t-${it.tab.id}`}
              className={`command-palette-item${i === index ? ' active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => activate(it)}
            >
              <span className="command-palette-item-label">{it.label}</span>
              <span className="command-palette-item-sub">{it.kind === 'tab' ? '↹ ' : ''}{it.sub}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
