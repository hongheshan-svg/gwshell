import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Play, Edit, Trash2, Check, X, Server, ScrollText } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useSnippetStore } from '../../stores/snippetStore';
import { useConfirm } from '../../hooks/useConfirm';
import { runScript } from '../../lib/sendScript';
import { sendInputToTab } from '../../lib/terminalLifecycle';
import { EmptyIllustration } from '../Icons/BrandIcons';
import type { Snippet } from '../../types';

const INTERACTIVE_TERMINAL_TYPES = new Set(['ssh', 'localshell', 'serial', 'docker']);

export const SnippetPanel: React.FC = () => {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { snippets, loaded, load, add, update, remove } = useSnippetStore();
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const setActiveNavItem = useAppStore((s) => s.setActiveNavItem);
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
    !!activeTab && activeTab.connected && INTERACTIVE_TERMINAL_TYPES.has(activeTab.type);

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
      <div className="sidebar-top">
        <div className="sidebar-seg" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={false}
            className="sidebar-seg__btn"
            onClick={() => setActiveNavItem('sessions')}
          >
            <Server size={12} />
            <span>{t('sidebar_tab_hosts')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={true}
            className="sidebar-seg__btn active"
            onClick={() => setActiveNavItem('snippets')}
          >
            <ScrollText size={12} />
            <span>{t('sidebar_tab_snippets')}</span>
          </button>
        </div>
        <div className="snippet-subbar">
          <span className="snippet-subbar-label">{t('snippet_title')}</span>
          <button
            type="button"
            className="sidebar-action-btn sidebar-add-btn"
            onClick={startCreate}
            title={t('snippet_add')}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {error && <div className="snippet-error">{error}</div>}

      {(creating || editing) && (
        <div className="snippet-form">
          <input
            className="snippet-input"
            placeholder={t('snippet_name')}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            autoFocus
          />
          <textarea
            className="snippet-input snippet-textarea"
            placeholder={t('snippet_command')}
            value={draftCmd}
            onChange={(e) => setDraftCmd(e.target.value)}
            rows={3}
          />
          <div className="snippet-form-actions">
            <button
              type="button"
              className="snippet-icon-btn"
              onClick={cancel}
              title={t('snippet_cancel')}
            >
              <X size={15} />
            </button>
            <button
              type="button"
              className="snippet-icon-btn snippet-icon-btn--primary"
              onClick={() => void submit()}
              title={t('snippet_save')}
            >
              <Check size={15} />
            </button>
          </div>
        </div>
      )}

      <div className="snippet-list">
        {snippets.length === 0 && !creating && (
          <div className="snippet-empty">
            <EmptyIllustration variant="snippets" size={48} />
            <span>{t('snippet_empty')}</span>
          </div>
        )}
        {snippets.map((s) => (
          <div className="snippet-item" key={s.id}>
            <div className="snippet-item-main" title={s.command}>
              <div className="snippet-item-name">{s.name}</div>
              <div className="snippet-item-cmd">{s.command}</div>
            </div>
            <div className="snippet-item-actions">
              <button
                type="button"
                className="snippet-icon-btn"
                onClick={() => send(s)}
                disabled={!canSend}
                title={t('snippet_send')}
              >
                <Play size={13} />
              </button>
              <button
                type="button"
                className="snippet-icon-btn"
                onClick={() => startEdit(s)}
                title={t('snippet_edit')}
              >
                <Edit size={13} />
              </button>
              <button
                type="button"
                className="snippet-icon-btn"
                onClick={() =>
                  void (async () => {
                    if (
                      await confirm({
                        title: t('common_delete_confirm_title'),
                        message: t('common_delete_confirm_body', { name: s.name }),
                        danger: true,
                      })
                    )
                      void remove(s.id);
                  })()
                }
                title={t('snippet_delete')}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
