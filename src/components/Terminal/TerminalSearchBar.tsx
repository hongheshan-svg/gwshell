import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import type { ISearchOptions } from '@xterm/addon-search';
import { useAppStore } from '../../stores/appStore';
import { terminalInstances } from './terminalRegistry';

// Decoration colors. @xterm/addon-search v0.16 only emits onDidChangeResults
// (match count) when decorations are enabled, and its ISearchDecorationOptions
// type requires the two overview-ruler colors, so they are always provided.
const SEARCH_OPTS: ISearchOptions = {
  decorations: {
    matchBackground: '#5a4500',
    matchOverviewRuler: '#5a4500',
    activeMatchBackground: '#b58900',
    activeMatchColorOverviewRuler: '#b58900',
  },
};

export const TerminalSearchBar: React.FC = () => {
  const { t } = useTranslation();
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setShowTerminalSearch = useAppStore((s) => s.setShowTerminalSearch);
  const [query, setQuery] = useState('');
  const [count, setCount] = useState<{ idx: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addon = () => (activeTabId ? terminalInstances.get(activeTabId)?.searchAddon : undefined);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const a = addon();
    if (!a) return;
    // Match-count reporting. onDidChangeResults is a non-optional IEvent in the
    // type, but guard the call/dispose anyway so a future API change can't crash.
    const sub = a.onDidChangeResults?.(({ resultIndex, resultCount }) => {
      setCount(resultCount > 0 ? { idx: resultIndex + 1, total: resultCount } : null);
    });
    return () => { try { sub?.dispose?.(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  const findNext = () => { if (query) addon()?.findNext(query, SEARCH_OPTS); };
  const findPrev = () => { if (query) addon()?.findPrevious(query, SEARCH_OPTS); };
  const close = () => {
    try { addon()?.clearDecorations?.(); } catch { /* noop */ }
    setCount(null);
    setShowTerminalSearch(false);
    // Return focus to the terminal so typing resumes immediately.
    try { (activeTabId ? terminalInstances.get(activeTabId)?.terminal : undefined)?.focus(); } catch { /* noop */ }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) findPrev(); else findNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const onChange = (value: string) => {
    setQuery(value);
    const a = addon();
    if (!value) { setCount(null); try { a?.clearDecorations?.(); } catch { /* noop */ } return; }
    a?.findNext(value, { ...SEARCH_OPTS, incremental: true });
  };

  return (
    <div className="terminal-search-bar" onKeyDown={onKeyDown}>
      <input
        ref={inputRef}
        className="terminal-search-input"
        placeholder={t('search_placeholder')}
        value={query}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="terminal-search-count">
        {count ? `${count.idx}/${count.total}` : (query ? t('search_no_results') : '')}
      </span>
      <button className="terminal-search-btn" onClick={findPrev} title="Prev"><ChevronUp size={14} /></button>
      <button className="terminal-search-btn" onClick={findNext} title="Next"><ChevronDown size={14} /></button>
      <button className="terminal-search-btn" onClick={close} title="Close"><X size={14} /></button>
    </div>
  );
};
