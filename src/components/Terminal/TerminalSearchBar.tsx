import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import type { ISearchOptions } from '@xterm/addon-search';
import { useAppStore } from '../../stores/appStore';
import { terminalInstances } from './terminalRegistry';

// Base decoration colors. @xterm/addon-search v0.16 only emits onDidChangeResults
// (match count) when decorations are enabled, and its ISearchDecorationOptions
// type requires the two overview-ruler colors, so they are always provided.
const BASE_DECORATIONS: ISearchOptions['decorations'] = {
  matchBackground: '#5a4500',
  matchOverviewRuler: '#5a4500',
  activeMatchBackground: '#b58900',
  activeMatchColorOverviewRuler: '#b58900',
};

export const TerminalSearchBar: React.FC = () => {
  const { t } = useTranslation();
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setShowTerminalSearch = useAppStore((s) => s.setShowTerminalSearch);
  const [query, setQuery] = useState('');
  const [count, setCount] = useState<{ idx: number; total: number } | null>(null);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addon = () => (activeTabId ? terminalInstances.get(activeTabId)?.searchAddon : undefined);

  // Guard against SyntaxError thrown by @xterm/addon-search when the regex
  // pattern is syntactically incomplete (e.g. "[" or "*"). An in-progress
  // invalid pattern is simply treated as a no-op.
  const safeFind = (fn: () => void) => { try { fn(); } catch { /* invalid regex in-progress */ } };

  const buildOpts = useCallback((extra?: Partial<ISearchOptions>): ISearchOptions => ({
    decorations: BASE_DECORATIONS,
    caseSensitive,
    regex: useRegex,
    wholeWord,
    ...extra,
  }), [caseSensitive, useRegex, wholeWord]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const a = addon();
    if (!a) return;
    // Match-count reporting. onDidChangeResults is a non-optional IEvent in the
    // type, but guard the call/dispose anyway so a future API change can't crash.
    const sub = a.onDidChangeResults?.(({ resultIndex, resultCount }) => {
      // resultIndex is -1 when the active match is unknown (e.g. match count
      // capped on very large result sets); show 0 in that case, not a negative.
      setCount(resultCount > 0 ? { idx: resultIndex >= 0 ? resultIndex + 1 : 0, total: resultCount } : null);
    });
    return () => { try { sub?.dispose?.(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  // Track the previous tab so we can clear its search decorations when the
  // user switches tabs while the search bar stays open — otherwise the old
  // tab keeps stale highlights and the new tab shows nothing.
  const prevTabRef = useRef<string | null>(null);

  // Re-run search when any toggle changes (or query changes while toggles are
  // active), AND when the active tab changes. query is included so the linter
  // dep rule is satisfied; the early return when !query keeps it a no-op on
  // empty input. On tab switch, clear the previous tab's decorations first.
  useEffect(() => {
    const prev = prevTabRef.current;
    if (prev && prev !== activeTabId) {
      try { terminalInstances.get(prev)?.searchAddon?.clearDecorations?.(); } catch { /* noop */ }
    }
    prevTabRef.current = activeTabId;
    if (!query) return;
    safeFind(() => addon()?.findNext(query, buildOpts({ incremental: true })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseSensitive, useRegex, wholeWord, query, activeTabId]);

  const findNext = () => { if (query) safeFind(() => addon()?.findNext(query, buildOpts())); };
  const findPrev = () => { if (query) safeFind(() => addon()?.findPrevious(query, buildOpts())); };
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
    safeFind(() => a?.findNext(value, buildOpts({ incremental: true })));
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
      <button
        className={`terminal-search-btn${caseSensitive ? ' active' : ''}`}
        onClick={() => setCaseSensitive((v) => !v)}
        title={t('search_case_sensitive')}
        aria-label={t('search_case_sensitive')}
        aria-pressed={caseSensitive}
      >Aa</button>
      <button
        className={`terminal-search-btn${useRegex ? ' active' : ''}`}
        onClick={() => setUseRegex((v) => !v)}
        title={t('search_use_regex')}
        aria-label={t('search_use_regex')}
        aria-pressed={useRegex}
      >.*</button>
      <button
        className={`terminal-search-btn${wholeWord ? ' active' : ''}`}
        onClick={() => setWholeWord((v) => !v)}
        title={t('search_whole_word')}
        aria-label={t('search_whole_word')}
        aria-pressed={wholeWord}
      >W</button>
      <button className="terminal-search-btn" onClick={findPrev} title={t('search_prev')}><ChevronUp size={14} /></button>
      <button className="terminal-search-btn" onClick={findNext} title={t('search_next')}><ChevronDown size={14} /></button>
      <button className="terminal-search-btn" onClick={close} title={t('search_close')}><X size={14} /></button>
    </div>
  );
};
