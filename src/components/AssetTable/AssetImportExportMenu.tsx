import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as dialogOpen, save as dialogSave } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  Download,
  FileCode2,
  FileDown,
  FileJson,
  FileSpreadsheet,
  KeyRound,
  ShieldCheck,
  Terminal,
  Upload,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useToast } from '../../hooks/useToast';
import type { SessionConfig } from '../../types';

interface Props {
  totalCount: number;
  selectedIds: string[];
  onAfterImport?: () => void;
}

type OpenMenu = 'import' | 'export' | null;

export const AssetImportExportMenu: React.FC<Props> = ({
  totalCount,
  selectedIds,
  onAfterImport,
}) => {
  const { t } = useTranslation();
  const setSessions = useAppStore((s) => s.setSessions);
  const toast = useToast();
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  const reloadSessions = async () => {
    const fresh = await invoke<SessionConfig[]>('get_sessions');
    setSessions(fresh);
    onAfterImport?.();
  };

  const handleImportFile = async () => {
    setOpenMenu(null);
    try {
      const path = await dialogOpen({
        title: t('asset_io_import_file'),
        multiple: false,
        filters: [
          { name: 'GWShell Assets / Full Backup (JSON / CSV)', extensions: ['json', 'csv'] },
          { name: 'JSON', extensions: ['json'] },
          { name: 'CSV', extensions: ['csv'] },
        ],
      });
      if (typeof path !== 'string' || !path) return;
      setBusy(true);
      const count = await invoke<number>('import_sessions_data', { path });
      await reloadSessions();
      toast.success({
        title: t('asset_io_import_ok_title'),
        message: t('asset_io_import_ok_msg', { count }),
      });
    } catch (e) {
      toast.error({ title: t('asset_io_failed_title'), message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleImportSshConfig = async (pickCustomFile: boolean) => {
    setOpenMenu(null);
    try {
      let chosenPath: string | null = null;
      if (pickCustomFile) {
        const picked = await dialogOpen({
          title: t('asset_io_import_ssh_file'),
          multiple: false,
        });
        if (typeof picked !== 'string' || !picked) return;
        chosenPath = picked;
      }
      setBusy(true);
      const count = await invoke<number>('import_ssh_config', { path: chosenPath });
      await reloadSessions();
      if (count > 0) {
        toast.success({
          title: t('asset_io_import_ok_title'),
          message: t('asset_io_import_ok_msg', { count }),
        });
      } else {
        toast.info({
          title: t('asset_io_import_ok_title'),
          message: t('asset_io_import_none_msg'),
        });
      }
    } catch (e) {
      toast.error({ title: t('asset_io_failed_title'), message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadCsvTemplate = async () => {
    setOpenMenu(null);
    try {
      const path = await dialogSave({
        title: t('asset_io_csv_template'),
        defaultPath: 'gwshell-assets-template.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (!path) return;
      setBusy(true);
      await invoke('export_assets_csv_template', { path });
      toast.success({
        title: t('asset_io_template_ok_title'),
        message: t('asset_io_template_ok_msg', { path }),
      });
    } catch (e) {
      toast.error({ title: t('asset_io_failed_title'), message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async (format: 'json' | 'csv' | 'full') => {
    setOpenMenu(null);
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const ext = format === 'csv' ? 'csv' : 'json';
      const titles = {
        json: t('asset_io_export_json'),
        csv: t('asset_io_export_csv'),
        full: t('asset_io_export_full'),
      };
      const baseName = format === 'full' ? 'gwshell-full-backup' : 'gwshell-assets';
      const path = await dialogSave({
        title: titles[format],
        defaultPath: `${baseName}-${dateStr}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (!path) return;
      setBusy(true);
      const count = await invoke<number>('export_sessions_data', {
        path,
        sessionIds: selectedIds.length > 0 ? selectedIds : null,
        format,
      });
      toast.success({
        title: t('asset_io_export_ok_title'),
        message:
          format === 'full'
            ? t('asset_io_export_full_ok_msg', { count })
            : t('asset_io_export_ok_msg', { count }),
      });
    } catch (e) {
      toast.error({ title: t('asset_io_failed_title'), message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const hasSelection = selectedIds.length > 0;
  const exportLabel = hasSelection
    ? t('asset_io_export_selected', { count: selectedIds.length })
    : t('asset_io_export');

  return (
    <div className="asset-io-group" ref={rootRef}>
      {/* Import Button + Menu */}
      <div className="asset-io-anchor">
        <button
          type="button"
          className={`asset-io-btn${openMenu === 'import' ? ' is-open' : ''}`}
          disabled={busy}
          aria-expanded={openMenu === 'import'}
          aria-haspopup="menu"
          onClick={() => setOpenMenu((m) => (m === 'import' ? null : 'import'))}
        >
          <Upload size={13} />
          <span>{t('asset_io_import')}</span>
          <ChevronDown size={12} className="asset-io-caret" />
        </button>

        {openMenu === 'import' && (
          <div className="asset-io-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="asset-io-item"
              onClick={() => {
                void handleImportFile();
              }}
            >
              <span className="asset-io-item__icon is-accent">
                <FileSpreadsheet size={14} />
              </span>
              <span className="asset-io-item__body">
                <strong>{t('asset_io_import_file')}</strong>
                <span>{t('asset_io_import_file_desc')}</span>
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              className="asset-io-item"
              onClick={() => {
                void handleImportSshConfig(false);
              }}
            >
              <span className="asset-io-item__icon is-ssh">
                <Terminal size={14} />
              </span>
              <span className="asset-io-item__body">
                <strong>{t('asset_io_import_ssh_default')}</strong>
                <span>{t('asset_io_import_ssh_default_desc')}</span>
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              className="asset-io-item"
              onClick={() => {
                void handleImportSshConfig(true);
              }}
            >
              <span className="asset-io-item__icon">
                <FileCode2 size={14} />
              </span>
              <span className="asset-io-item__body">
                <strong>{t('asset_io_import_ssh_file')}</strong>
                <span>{t('asset_io_import_ssh_file_desc')}</span>
              </span>
            </button>

            <div className="asset-io-divider" />

            <button
              type="button"
              role="menuitem"
              className="asset-io-item"
              onClick={() => {
                void handleDownloadCsvTemplate();
              }}
            >
              <span className="asset-io-item__icon">
                <FileDown size={14} />
              </span>
              <span className="asset-io-item__body">
                <strong>{t('asset_io_csv_template')}</strong>
                <span>{t('asset_io_csv_template_desc')}</span>
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Export Button + Menu */}
      <div className="asset-io-anchor">
        <button
          type="button"
          className={`asset-io-btn${openMenu === 'export' ? ' is-open' : ''}${hasSelection ? ' has-selection' : ''}`}
          disabled={busy || totalCount === 0}
          aria-expanded={openMenu === 'export'}
          aria-haspopup="menu"
          onClick={() => setOpenMenu((m) => (m === 'export' ? null : 'export'))}
        >
          <Download size={13} />
          <span>{exportLabel}</span>
          <ChevronDown size={12} className="asset-io-caret" />
        </button>

        {openMenu === 'export' && (
          <div className="asset-io-menu" role="menu">
            <div className="asset-io-note">
              <ShieldCheck size={12} />
              <span>
                {hasSelection
                  ? t('asset_io_export_scope_selected', { count: selectedIds.length })
                  : t('asset_io_export_scope_all', { count: totalCount })}
              </span>
            </div>

            <button
              type="button"
              role="menuitem"
              className="asset-io-item"
              onClick={() => {
                void handleExport('json');
              }}
            >
              <span className="asset-io-item__icon is-accent">
                <FileJson size={14} />
              </span>
              <span className="asset-io-item__body">
                <strong>{t('asset_io_export_json')}</strong>
                <span>{t('asset_io_export_json_desc')}</span>
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              className="asset-io-item"
              onClick={() => {
                void handleExport('csv');
              }}
            >
              <span className="asset-io-item__icon is-csv">
                <FileSpreadsheet size={14} />
              </span>
              <span className="asset-io-item__body">
                <strong>{t('asset_io_export_csv')}</strong>
                <span>{t('asset_io_export_csv_desc')}</span>
              </span>
            </button>

            <div className="asset-io-divider" />

            <button
              type="button"
              role="menuitem"
              className="asset-io-item"
              onClick={() => {
                void handleExport('full');
              }}
            >
              <span className="asset-io-item__icon">
                <KeyRound size={14} />
              </span>
              <span className="asset-io-item__body">
                <strong>{t('asset_io_export_full')}</strong>
                <span>{t('asset_io_export_full_desc')}</span>
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
