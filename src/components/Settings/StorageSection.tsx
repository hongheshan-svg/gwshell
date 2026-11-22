import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open as dialogOpen, save as dialogSave } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../../stores/appStore';
import type { SessionConfig } from '../../types';
import { SectionTitle } from './SettingsControls';

export const StorageSection: React.FC = () => {
  const { t } = useTranslation();
  const setSessions = useAppStore((s) => s.setSessions);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  const refreshSessions = async () => {
    setSessions(await invoke<SessionConfig[]>('get_sessions'));
  };

  const handleExport = async () => {
    setMsg(null);
    try {
      const path = await dialogSave({
        title: t('settings_storage_export'),
        defaultPath: `gwshell-sessions-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path) return;
      setBusy(true);
      await invoke('export_sessions_data', { path });
      setMsg({ kind: 'ok', text: t('settings_storage_exported', { path }) });
    } catch (e) {
      setMsg({ kind: 'err', text: t('settings_storage_failed', { msg: String(e) }) });
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    setMsg(null);
    try {
      const path = await dialogOpen({
        title: t('settings_storage_import'),
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (typeof path !== 'string' || !path) return;
      setBusy(true);
      const count = await invoke<number>('import_sessions_data', { path });
      await refreshSessions();
      setMsg({ kind: 'ok', text: t('settings_storage_imported', { count }) });
    } catch (e) {
      setMsg({ kind: 'err', text: t('settings_storage_failed', { msg: String(e) }) });
    } finally {
      setBusy(false);
    }
  };

  const handleImportSshConfig = async () => {
    setMsg(null);
    try {
      setBusy(true);
      const count = await invoke<number>('import_ssh_config', { path: null });
      await refreshSessions();
      setMsg({ kind: 'ok', text: t('settings_storage_imported', { count }) });
    } catch (e) {
      setMsg({ kind: 'err', text: t('settings_storage_failed', { msg: String(e) }) });
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    setMsg(null);
    try {
      setBusy(true);
      await invoke('clear_local_data');
      await refreshSessions();
      setMsg({ kind: 'ok', text: t('settings_storage_cleared') });
    } catch (e) {
      setMsg({ kind: 'err', text: t('settings_storage_failed', { msg: String(e) }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>{t('settings_storage_sync')}</SectionTitle>
      <div className="settings-col" style={{ maxWidth: 700 }}>
        <div className="storage-row">
          <span className="settings-label">{t('settings_storage_local_data')}</span>
          <span className="settings-desc" style={{ flex: 1 }}>
            {t('settings_storage_local_data_desc')}
          </span>
          <button
            type="button"
            className="settings-btn-danger"
            disabled={busy}
            onClick={() => {
              void handleClear();
            }}
          >
            {confirmClear ? t('settings_storage_clear_confirm') : t('settings_storage_clear')}
          </button>
        </div>
        <div className="storage-row">
          <span className="settings-label">{t('settings_storage_import_export')}</span>
          <span className="settings-desc" style={{ flex: 1 }}>
            {t('settings_storage_import_export_desc')}
          </span>
          <button
            type="button"
            className="settings-btn-outline"
            style={{ marginRight: 6 }}
            disabled={busy}
            onClick={() => {
              void handleImport();
            }}
          >
            {t('settings_storage_import')}
          </button>
          <button
            type="button"
            className="settings-btn-outline"
            disabled={busy}
            onClick={() => {
              void handleExport();
            }}
          >
            {t('settings_storage_export')}
          </button>
        </div>
        <div className="storage-row">
          <span className="settings-label">{t('settings_storage_sshconfig')}</span>
          <span className="settings-desc" style={{ flex: 1 }}>
            {t('settings_storage_sshconfig_desc')}
          </span>
          <button
            type="button"
            className="settings-btn-outline"
            disabled={busy}
            onClick={() => {
              void handleImportSshConfig();
            }}
          >
            {t('settings_storage_import')}
          </button>
        </div>
        {msg && (
          <p
            className="settings-desc"
            style={{ marginTop: 8, color: msg.kind === 'err' ? 'var(--danger)' : 'var(--success)' }}
          >
            {msg.text}
          </p>
        )}
      </div>
    </>
  );
};
