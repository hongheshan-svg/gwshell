import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Play, Edit, Trash2, Check, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useSnippetStore } from '../../stores/snippetStore';
import { expandSnippet } from '../../lib/snippetExpand';
import { sendInputToTab } from '../Terminal/TerminalView';
import type { Snippet } from '../../types';

export const SnippetPanel: React.FC = () => {
  const { t } = useTranslation();
  const { snippets, loaded, load, add, update, remove } = useSnippetStore();
  const { sidebarCollapsed, activeTabId, tabs } = useAppStore();
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftCmd, setDraftCmd] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  if (sidebarCollapsed) return null;

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const canSend =
    !!activeTab &&
    activeTab.connected &&
    activeTab.type !== 'asset-list';

  const send = (snippet: Snippet) => {
    if (!canSend || !activeTab) {
      setError(t('snippet_no_terminal'));
      return;
    }
    setError('');
    let delay = 0;
    for (const seg of expandSnippet(snippet.command)) {
      if (seg.kind === 'delay') {
        delay += seg.delayMs;
      } else {
        const text = seg.text;
        if (delay === 0) sendInputToTab(activeTab.id, text);
        else setTimeout(() => sendInputToTab(activeTab.id, text), delay);
      }
    }
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
