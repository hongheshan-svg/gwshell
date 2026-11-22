import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ListTree, Search, X } from 'lucide-react';
import type { ProcInfo } from '../../types/serverMetrics';
import { fmtKb, usageLevel } from './format';

interface Props {
  sessionId: string;
  procs: ProcInfo[] | null;
}

type SortKey = 'cpu' | 'mem';

export const ProcessList: React.FC<Props> = ({ sessionId, procs }) => {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [armedPid, setArmedPid] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('cpu');
  const armedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (armedTimerRef.current) clearTimeout(armedTimerRef.current);
    };
  }, []);

  const filtered = useMemo(() => {
    const list = procs ?? [];
    const q = query.trim().toLowerCase();
    const matched = q
      ? list.filter((p) => p.comm.toLowerCase().includes(q) || String(p.pid).includes(q))
      : list.slice();
    matched.sort((a, b) =>
      sortBy === 'mem'
        ? b.rss_kb - a.rss_kb || b.cpu_percent - a.cpu_percent
        : b.cpu_percent - a.cpu_percent || b.rss_kb - a.rss_kb,
    );
    return matched;
  }, [procs, query, sortBy]);

  const handleKillClick = async (p: ProcInfo) => {
    if (armedPid !== p.pid) {
      setArmedPid(p.pid);
      if (armedTimerRef.current) clearTimeout(armedTimerRef.current);
      armedTimerRef.current = setTimeout(() => {
        armedTimerRef.current = null;
        setArmedPid((cur) => (cur === p.pid ? null : cur));
      }, 3000);
      return;
    }
    if (armedTimerRef.current) {
      clearTimeout(armedTimerRef.current);
      armedTimerRef.current = null;
    }
    setArmedPid(null);
    setPending((prev) => new Set(prev).add(p.pid));
    try {
      await invoke('kill_remote_process', { sessionId, pid: p.pid });
    } catch (e) {
      console.warn('kill_remote_process failed', e);
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(p.pid);
        return next;
      });
    }
  };

  return (
    <div className="sp-card sp-card--procs">
      <div className="sp-card__header">
        <div className="sp-card__title">
          <span className="sp-card__icon sp-card__icon--procs">
            <ListTree size={12} />
          </span>
          <span>{t('serverPanel_proc_title')}</span>
          {procs && <span className="sp-count-pill">{filtered.length}</span>}
        </div>
        <div className="sp-sort-seg" role="group">
          <button
            type="button"
            className={`sp-sort-btn${sortBy === 'cpu' ? ' is-active' : ''}`}
            onClick={() => setSortBy('cpu')}
          >
            {t('serverPanel_proc_sort_cpu')}
          </button>
          <button
            type="button"
            className={`sp-sort-btn${sortBy === 'mem' ? ' is-active' : ''}`}
            onClick={() => setSortBy('mem')}
          >
            {t('serverPanel_proc_sort_mem')}
          </button>
        </div>
      </div>

      <div className="sp-proc-search">
        <Search size={12} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('serverPanel_proc_search')}
        />
        {query && (
          <button
            type="button"
            className="sp-proc-search__clear"
            onClick={() => setQuery('')}
            aria-label="clear"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {!procs || procs.length === 0 ? (
        <div className="sp-empty">—</div>
      ) : filtered.length === 0 ? (
        <div className="sp-empty">{t('serverPanel_proc_empty_filter')}</div>
      ) : (
        <div className="sp-proc-list">
          <div className="sp-proc-head">
            <span>{t('serverPanel_proc_col_process')}</span>
            <span>{t('serverPanel_proc_col_pid')}</span>
            <span>{t('serverPanel_proc_col_cpu')}</span>
            <span>{t('serverPanel_proc_col_mem')}</span>
            <span />
          </div>
          {filtered.map((p) => {
            const cpuBar = Math.min(100, Math.max(0, p.cpu_percent));
            return (
              <div key={p.pid} className="sp-proc-row">
                <div className="sp-proc-name" title={p.comm}>
                  <span className="sp-proc-name__text">{p.comm}</span>
                  <span className="sp-proc-bar">
                    <span
                      className={`sp-proc-bar__fill is-${usageLevel(cpuBar)}`}
                      style={{ width: `${cpuBar}%` }}
                    />
                  </span>
                </div>
                <code className="sp-proc-pid">{p.pid}</code>
                <span className={`sp-proc-cpu is-${usageLevel(cpuBar)}`}>
                  {p.cpu_percent.toFixed(1)}%
                </span>
                <span className="sp-proc-mem">{fmtKb(p.rss_kb)}</span>
                <button
                  type="button"
                  className={`sp-kill-btn${armedPid === p.pid ? ' sp-kill-btn--armed' : ''}`}
                  disabled={pending.has(p.pid)}
                  onClick={() => {
                    void handleKillClick(p);
                  }}
                  title={
                    armedPid === p.pid
                      ? t('serverPanel_proc_kill_confirm_body', { pid: p.pid, name: p.comm })
                      : t('serverPanel_proc_kill')
                  }
                >
                  {armedPid === p.pid ? (
                    <span className="sp-kill-btn__label">
                      {t('serverPanel_proc_kill_confirm_ok')}
                    </span>
                  ) : (
                    <X size={12} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
