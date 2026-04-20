import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
import type { ProcInfo } from '../../types/serverMetrics';

interface Props {
  sessionId: string;
  procs: ProcInfo[] | null;
}

function fmtKb(kb: number): string {
  if (kb < 1024) return `${kb}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
}

export const ProcessList: React.FC<Props> = ({ sessionId, procs }) => {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [armedPid, setArmedPid] = useState<number | null>(null);

  const handleKillClick = async (p: ProcInfo) => {
    if (armedPid !== p.pid) {
      setArmedPid(p.pid);
      setTimeout(() => {
        setArmedPid((cur) => (cur === p.pid ? null : cur));
      }, 3000);
      return;
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
      <div className="sp-card__title">{t('serverPanel_proc_title')}</div>
      {(!procs || procs.length === 0) ? (
        <div className="sp-empty">—</div>
      ) : (
        <table className="sp-table sp-table--procs">
          <thead>
            <tr>
              <th>{t('serverPanel_proc_col_process')}</th>
              <th>{t('serverPanel_proc_col_pid')}</th>
              <th>{t('serverPanel_proc_col_cpu')}</th>
              <th>{t('serverPanel_proc_col_mem')}</th>
              <th>{t('serverPanel_proc_col_action')}</th>
            </tr>
          </thead>
          <tbody>
            {procs.map((p) => (
              <tr key={p.pid}>
                <td title={p.comm}>{p.comm}</td>
                <td>{p.pid}</td>
                <td>{p.cpu_percent.toFixed(1)}%</td>
                <td>{fmtKb(p.rss_kb)}</td>
                <td>
                  <button
                    className={`sp-kill-btn${armedPid === p.pid ? ' sp-kill-btn--armed' : ''}`}
                    disabled={pending.has(p.pid)}
                    onClick={() => handleKillClick(p)}
                    title={
                      armedPid === p.pid
                        ? t('serverPanel_proc_kill_confirm_body', { pid: p.pid, name: p.comm })
                        : t('serverPanel_proc_kill')
                    }
                  >
                    <X size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
