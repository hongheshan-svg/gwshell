import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Play, Edit, Trash2, Check, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useSnippetStore } from '../../stores/snippetStore';
import { runScript } from '../../lib/sendScript';
import { sendInputToTab } from '../Terminal/TerminalView';
import type { Snippet } from '../../types';

// Only interactive terminal tabs can receive snippet input. SFTP tabs render
// SftpPanel (not TerminalView), so tabInputSenders has no entry for them —
// sending would silently fail even though connected=true. Allowlist the four
// types that are backed by a live terminal instance.
const INTERACTIVE_TERMINAL_TYPES = new Set(['ssh', 'localshell', 'serial', 'docker']);

export const SnippetPanel: React.FC = () => {
  const { t } = useTranslation();
  const { snippets, loaded, load, add, update, remove } = useSnippetStore();
  const { activeTabId, tabs } = useAppStore();
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftCmd, setDraftCmd] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const canSend =
    !!activeTab &&
    activeTab.connected &&
    INTERACTIVE_TERMINAL_TYPES.has(activeTab.type);

  const send = (snippet: Snippet) => {
    if (!canSend || !activeTab) {
      setError(t('snippet_no_terminal'));
      return;
    }
    setError('');
    runScript((d) => sendInputToTab(activeTab.id, d), snippet.command);
  };

  const startCreate = () => {
    setCreating(true);
    setEditing(null);
    setDraftName('');
    setDraftCmd('');
  };
  const startEdit = (s: Snippet) => {
    setEditing(s);
    setCreating(false);
    setDraftName(s.name);
    setDraftCmd(s.command);
  };
  const cancel = () => {
    setCreating(false);
    setEditing(null);
  };
  const submit = async () => {
    const name = draftName.trim() || draftCmd.trim().slice(0, 24);
    const command = draftCmd;
    if (!command.trim()) return;
    if (editing) await update({ ...editing, name, command });
    else await add({ name, command });
    cancel();
  };

  return (
    <div className="snippet-panel">
      <div className="snippet-panel-header">
        <span>{t('snippet_title')}</span>
        <button className="snippet-icon-btn" onClick={startCreate} title={t('snippet_add')}>
          <Plus size={16} />
        </button>
      </div>

      {error && <div className="snippet-error">{error}</div>}

      {(creating || editing) && (
        <div className="snippet-form">
          <input
            className="snippet-input"
            placeholder={t('snippet_name')}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
          />
          <textarea
            className="snippet-input snippet-textarea"
            placeholder={t('snippet_command')}
            value={draftCmd}
            onChange={(e) => setDraftCmd(e.target.value)}
            rows={3}
          />
          <div className="snippet-form-actions">
            <button className="snippet-icon-btn" onClick={() => void submit()} title={t('snippet_save')}>
              <Check size={16} />
            </button>
            <button className="snippet-icon-btn" onClick={cancel} title={t('snippet_cancel')}>
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="snippet-list">
        {snippets.length === 0 && !creating && (
          <div className="snippet-empty">{t('snippet_empty')}</div>
        )}
        {snippets.map((s) => (
          <div className="snippet-item" key={s.id}>
            <div className="snippet-item-main" title={s.command}>
              <div className="snippet-item-name">{s.name}</div>
              <div className="snippet-item-cmd">{s.command}</div>
            </div>
            <div className="snippet-item-actions">
              <button
                className="snippet-icon-btn"
                onClick={() => send(s)}
                disabled={!canSend}
                title={t('snippet_send')}
              >
                <Play size={14} />
              </button>
              <button className="snippet-icon-btn" onClick={() => startEdit(s)} title={t('snippet_edit')}>
                <Edit size={14} />
              </button>
              <button className="snippet-icon-btn" onClick={() => void remove(s.id)} title={t('snippet_delete')}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
