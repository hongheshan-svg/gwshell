import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, FolderOpen, ChevronDown } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../../stores/appStore';
import { useEscapeClose } from '../../lib/useEscapeClose';
import { GroupSelectField } from './GroupSelectField';
import { ColorLabelPicker } from './ColorLabelPicker';
import type { SessionConfig } from '../../types';

const CHARSETS = [
  'UTF-8',
  'GBK',
  'GB2312',
  'GB18030',
  'Big5',
  'Shift-JIS',
  'EUC-JP',
  'EUC-KR',
  'KOI8-R',
  'Windows-1252',
  'ISO-8859-1',
  'ASCII',
];

interface ShellOption {
  id: string;
  label: string;
}

// ---- Custom shell picker dropdown ----
const ShellPicker: React.FC<{
  value: string;
  options: ShellOption[];
  onChange: (v: string) => void;
}> = ({ value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); // eslint-disable-line no-restricted-syntax -- DOM EventTarget to Node; runtime-checked by contains()
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const currentLabel = options.find((o) => o.id === value)?.label ?? value;

  return (
    <div ref={ref} className="shell-picker" style={{ position: 'relative' }}>
      <button type="button" className="shell-picker-btn" onClick={() => setOpen((o) => !o)}>
        <span>{currentLabel || 'powershell'}</span>
        <ChevronDown
          size={14}
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}
        />
      </button>
      {open && (
        <div className="shell-picker-list">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`shell-picker-item ${value === opt.id ? 'active' : ''}`}
              onClick={() => {
                onChange(opt.id);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ---- Modal ----
export const LocalTerminalModal: React.FC = () => {
  const showLocalTerminalModal = useAppStore((s) => s.showLocalTerminalModal);
  const setShowLocalTerminalModal = useAppStore((s) => s.setShowLocalTerminalModal);
  const editingSession = useAppStore((s) => s.editingSession);
  const setEditingSession = useAppStore((s) => s.setEditingSession);
  const addSession = useAppStore((s) => s.addSession);
  const addTab = useAppStore((s) => s.addTab);
  const { t } = useTranslation();
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [shellOptions, setShellOptions] = useState<ShellOption[]>([
    { id: 'powershell', label: 'powershell' },
  ]);
  const [form, setForm] = useState({
    name: '',
    group: '',
    color_label: '',
    shell: 'powershell',
    custom_shell_path: '',
    charset: 'UTF-8',
    init_command: '',
    working_dir: '',
    remark: '',
  });

  const isEditing = editingSession?.session_type === 'localshell';

  useEffect(() => {
    if (showLocalTerminalModal) {
      const editingLocal = editingSession?.session_type === 'localshell' ? editingSession : null;
      const savedShell = editingLocal?.shell_name ?? 'powershell';
      const looksCustomPath =
        savedShell.startsWith('/') || savedShell.includes('\\') || savedShell === 'custom';
      if (editingLocal) {
        setForm({
          name: editingLocal.name,
          group: editingLocal.group ?? '',
          color_label: editingLocal.color_label ?? '',
          shell: looksCustomPath ? 'custom' : savedShell,
          custom_shell_path: looksCustomPath && savedShell !== 'custom' ? savedShell : '',
          charset: editingLocal.charset ?? 'UTF-8',
          init_command: editingLocal.init_command ?? '',
          working_dir: editingLocal.working_dir ?? '',
          remark: editingLocal.remark ?? '',
        });
      } else {
        setForm({
          name: '',
          group: '',
          color_label: '',
          shell: 'powershell',
          custom_shell_path: '',
          charset: 'UTF-8',
          init_command: '',
          working_dir: '',
          remark: '',
        });
      }
      setTouched({});
      // Load available shells from backend
      invoke<ShellOption[]>('list_shells')
        .then((list) => {
          const mapped = list.map((s) =>
            s.id === 'custom' ? { ...s, label: t('local_shell_custom') } : s,
          );
          setShellOptions(mapped);
          if (!editingLocal) {
            const first = mapped.find((s) => s.id !== 'custom');
            if (first) setForm((f) => ({ ...f, shell: first.id }));
          }
        })
        .catch(() => {
          /* keep default */
        });
    }
    // t is stable (i18next fixed-T); intentionally omitted to avoid re-running
    // the shell-discovery effect on language change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLocalTerminalModal, editingSession]);

  // Hooks must run unconditionally (before any early return) per rules-of-hooks.
  const handleClose = () => {
    setShowLocalTerminalModal(false);
    setEditingSession(null);
  };
  useEscapeClose(handleClose);

  if (!showLocalTerminalModal) return null;

  const handlePickDir = async () => {
    try {
      const selected = await dialogOpen({
        directory: true,
        multiple: false,
        title: t('local_select_dir'),
      });
      if (typeof selected === 'string' && selected) {
        setForm((prev) => ({ ...prev, working_dir: selected }));
      }
    } catch {
      /* canceled */
    }
  };

  const buildConfig = (sessionId: string): SessionConfig => ({
    id: sessionId,
    name: form.name,
    session_type: 'localshell',
    auth_method: 'password',
    group: form.group.trim() || undefined,
    color_label: form.color_label || undefined,
    shell_name: form.shell === 'custom' ? form.custom_shell_path.trim() || undefined : form.shell,
    charset: form.charset,
    init_command: form.init_command || undefined,
    working_dir: form.working_dir || undefined,
    remark: form.remark || undefined,
    created_at: isEditing ? editingSession.created_at : new Date().toISOString().slice(0, 10),
  });

  const handleSave = () => {
    setTouched({ name: true });
    if (!form.name) return;
    const sessionId = isEditing ? editingSession.id : crypto.randomUUID();
    addSession(buildConfig(sessionId));
    handleClose();
  };

  const handleTestConnect = () => {
    setTouched({ name: true });
    if (!form.name) return;
    const sessionId = isEditing ? editingSession.id : crypto.randomUUID();
    addSession(buildConfig(sessionId));
    const existingTab = useAppStore.getState().tabs.find((tb) => tb.sessionId === sessionId);
    if (existingTab) {
      useAppStore.getState().setActiveTab(existingTab.id);
    } else {
      addTab({
        id: crypto.randomUUID(),
        sessionId,
        title: form.name,
        type: 'localshell',
        connected: false,
      });
    }
    handleClose();
  };

  const nameError = touched.name && !form.name;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="ssh-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ssh-modal-header">
          <h2>{t('local_config_title')}</h2>
          <button className="modal-close" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="ssh-modal-body">
          {/* Row: color + name */}
          <div className="ssh-form-row">
            <ColorLabelPicker
              value={form.color_label}
              onChange={(color_label) => setForm({ ...form, color_label })}
            />
            <div className="ssh-form-group">
              <label className={nameError ? 'label-error' : ''}>{t('ssh_name')}</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onBlur={() => setTouched((p) => ({ ...p, name: true }))}
                className={nameError ? 'input-error' : ''}
                placeholder="My Terminal"
              />
              {nameError && <span className="field-error">{t('field_required')}</span>}
            </div>
          </div>

          <GroupSelectField value={form.group} onChange={(group) => setForm({ ...form, group })} />

          {/* Shell picker */}
          <div className="ssh-form-group">
            <label>Shell</label>
            <ShellPicker
              value={form.shell}
              options={shellOptions}
              onChange={(v) => setForm({ ...form, shell: v })}
            />
          </div>

          {form.shell === 'custom' && (
            <div className="ssh-form-group">
              <label>{t('local_shell_custom_path')}</label>
              <input
                type="text"
                value={form.custom_shell_path}
                onChange={(e) => setForm({ ...form, custom_shell_path: e.target.value })}
                placeholder="/usr/local/bin/zsh"
              />
            </div>
          )}

          {/* Charset */}
          <div className="ssh-form-group">
            <label>{t('local_charset')}</label>
            <select
              value={form.charset}
              onChange={(e) => setForm({ ...form, charset: e.target.value })}
            >
              {CHARSETS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Init command */}
          <div className="ssh-form-group">
            <label>{t('local_init_command')}</label>
            <input
              type="text"
              value={form.init_command}
              onChange={(e) => setForm({ ...form, init_command: e.target.value })}
              placeholder={t('local_init_placeholder')}
            />
          </div>

          {/* Working directory */}
          <div className="ssh-form-group">
            <label>{t('local_working_dir')}</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={form.working_dir}
                onChange={(e) => setForm({ ...form, working_dir: e.target.value })}
                onDoubleClick={() => {
                  void handlePickDir();
                }}
                placeholder={t('local_working_dir_placeholder')}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={() => {
                  void handlePickDir();
                }}
                title={t('local_select_dir')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 32,
                  width: 32,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <FolderOpen size={15} />
              </button>
            </div>
          </div>

          {/* Remark */}
          <div className="ssh-form-group">
            <label>{t('ssh_remark')}</label>
            <textarea
              className="ssh-remark"
              rows={3}
              value={form.remark}
              onChange={(e) => setForm({ ...form, remark: e.target.value })}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="ssh-modal-footer">
          <button type="button" className="ssh-footer-link" onClick={handleTestConnect}>
            {t('ssh_save_and_connect')}
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            {t('ssh_save')}
          </button>
        </div>
      </div>
    </div>
  );
};
