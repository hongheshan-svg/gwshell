import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAutoModeStore } from '../../stores/autoModeStore';
import { useAppStore } from '../../stores/appStore';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export const AutoModeLogPanel: React.FC = () => {
  const open = useAutoModeStore((s) => s.logPanelOpen);
  const tabId = useAutoModeStore((s) => s.logPanelTabId);
  const entries = useAutoModeStore((s) => (tabId ? s.logs[tabId] ?? [] : []));
  const closeLogPanel = useAutoModeStore((s) => s.closeLogPanel);
  const clearLog = useAutoModeStore((s) => s.clearLog);
  const tabs = useAppStore((s) => s.tabs);
  const { t } = useTranslation();

  const tab = useMemo(() => tabs.find((tb) => tb.id === tabId), [tabs, tabId]);

  if (!open || !tabId) return null;

  const kindIcon = (k: 'info' | 'warning' | 'error') =>
    k === 'info' ? '✓' : k === 'warning' ? '⚠' : '✗';

  const handleExport = () => {
    const payload = {
      tabId,
      tabTitle: tab?.title ?? '',
      exportedAt: new Date().toISOString(),
      entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gwshell-automode-${tabId}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="auto-mode-log-panel">
      <div className="auto-mode-log-panel-header">
        <span>{t('auto_mode_log_title', { tabTitle: tab?.title ?? '' })}</span>
        <button className="auto-mode-log-panel-close" onClick={closeLogPanel}>
          <X size={13} />
        </button>
      </div>
      <div className="auto-mode-log-panel-body">
        {entries.length === 0 ? (
          <div style={{ padding: '20px 0', color: 'var(--text-muted, #888)' }}>
            {t('auto_mode_log_empty')}
          </div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className={`auto-mode-log-row ${e.kind}`}>
              <span>{formatTime(e.time)}</span>
              <span>{kindIcon(e.kind)}</span>
              <span>{e.label}</span>
              <span style={{ opacity: 0.6 }}>{e.ruleName ?? ''}</span>
            </div>
          ))
        )}
      </div>
      <div className="auto-mode-log-panel-footer">
        <button className="auto-mode-log-btn" onClick={() => clearLog(tabId)}>
          {t('auto_mode_log_clear')}
        </button>
        <button className="auto-mode-log-btn" onClick={handleExport}>
          {t('auto_mode_log_export')}
        </button>
      </div>
    </div>
  );
};
