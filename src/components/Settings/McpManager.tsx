import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, RefreshCw, Check } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  syncApps: { claude: boolean; codex: boolean; gemini: boolean; opencode: boolean };
  enabled: boolean;
}

export const McpManager: React.FC = () => {
  const { t } = useTranslation();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<McpServer | null>(null);
  const [status, setStatus] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<McpServer[]>([]);

  const loadData = useCallback(async () => {
    try {
      const list = await invoke<McpServer[]>('list_mcp_servers');
      setServers(list);
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0].id);
        setEditForm(list[0]);
      }
    } catch { /* empty */ }
  }, [selectedId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    invoke<McpServer[]>('get_mcp_templates').then(setTemplates).catch(() => {});
  }, []);

  const newServer = (): McpServer => ({
    id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    command: '',
    args: [],
    env: {},
    syncApps: { claude: true, codex: true, gemini: true, opencode: true },
    enabled: true,
  });

  const handleAdd = (template?: McpServer) => {
    const s = template ? { ...template, id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } : newServer();
    setSelectedId(s.id);
    setEditForm(s);
    setShowTemplates(false);
  };

  const handleSave = async () => {
    if (!editForm) return;
    try {
      await invoke('save_mcp_server', { server: editForm });
      setStatus(t('mcp_save_success'));
      await loadData();
      setSelectedId(editForm.id);
      setTimeout(() => setStatus(''), 2000);
    } catch (e: any) {
      setStatus(`Error: ${e}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke('delete_mcp_server', { serverId: id });
      setStatus(t('mcp_delete_success'));
      if (selectedId === id) { setSelectedId(null); setEditForm(null); }
      await loadData();
      setTimeout(() => setStatus(''), 2000);
    } catch (e: any) {
      setStatus(`Error: ${e}`);
    }
  };

  const handleSync = async () => {
    try {
      await invoke('sync_mcp_servers');
      setStatus(t('mcp_sync_success'));
      setTimeout(() => setStatus(''), 2000);
    } catch (e: any) {
      setStatus(`Error: ${e}`);
    }
  };

  const updateArgs = (value: string) => {
    setEditForm(prev => prev ? { ...prev, args: value.split('\n').filter(Boolean) } : null);
  };

  const updateEnv = (value: string) => {
    const env: Record<string, string> = {};
    value.split('\n').forEach(line => {
      const idx = line.indexOf('=');
      if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    setEditForm(prev => prev ? { ...prev, env } : null);
  };

  return (
    <div className="settings-columns" style={{ gap: 0 }}>
      {/* Left: Server list */}
      <div className="ai-provider-panel">
        <div className="ai-provider-panel-header">
          <h3>{t('mcp_title')}</h3>
          <p>{t('mcp_desc')}</p>
        </div>

        <div className="ai-provider-toolbar">
          <div className="ai-provider-add-wrap">
            <button className="ai-toolbar-btn" onClick={() => setShowTemplates(!showTemplates)}>
              <Plus size={13} /> {t('mcp_add')}
            </button>
            {showTemplates && (
              <div className="ai-preset-dropdown">
                <button className="ai-preset-item" onClick={() => handleAdd()}>{t('mcp_custom')}</button>
                {templates.map(tpl => (
                  <button key={tpl.id} className="ai-preset-item" onClick={() => handleAdd(tpl)}>
                    {tpl.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="ai-toolbar-btn" onClick={handleSync} title={t('mcp_sync_all')}>
            <RefreshCw size={13} /> {t('mcp_sync_all')}
          </button>
        </div>

        <div className="ai-provider-list">
          {servers.map(s => (
            <div
              key={s.id}
              className={`ai-provider-card ${selectedId === s.id ? 'selected' : ''}`}
              onClick={() => { setSelectedId(s.id); setEditForm({ ...s }); }}
            >
              <div className="ai-provider-card-info">
                <span className="ai-provider-name">{s.name || t('mcp_new_server')}</span>
                <span className="ai-provider-type">{s.command}</span>
              </div>
              <div className="ai-provider-badges">
                {s.enabled ? (
                  <span className="ai-badge active" title={t('mcp_status_enabled')}>✓</span>
                ) : (
                  <span className="ai-badge" title={t('mcp_status_disabled')}>✗</span>
                )}
              </div>
            </div>
          ))}
          {servers.length === 0 && (
            <div className="ai-config-empty" style={{ height: 200 }}>
              <p>{t('mcp_no_servers')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Right: Edit form */}
      <div className="settings-col ai-editor-col">
        {editForm ? (
          <>
            <div className="ai-editor-header">
              <h3>{editForm.name || t('mcp_new_server')}</h3>
              <div className="ai-editor-actions">
                <button className="ai-toolbar-btn primary" onClick={handleSave}>
                  <Check size={13} /> {t('common_save')}
                </button>
                {servers.find(s => s.id === editForm.id) && (
                  <button className="ai-toolbar-btn danger" onClick={() => handleDelete(editForm.id)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>

            {status && <div className="ai-status-bar">{status}</div>}

            <div className="ai-form">
              <div className="ai-form-section">
                <label className="ai-form-label">{t('mcp_name')}</label>
                <input className="settings-input ai-form-input" value={editForm.name}
                  onChange={e => setEditForm(prev => prev ? { ...prev, name: e.target.value } : null)}
                  placeholder="filesystem" />
              </div>

              <div className="ai-form-section">
                <label className="ai-form-label">{t('mcp_command')}</label>
                <input className="settings-input ai-form-input" value={editForm.command}
                  onChange={e => setEditForm(prev => prev ? { ...prev, command: e.target.value } : null)}
                  placeholder="npx" />
              </div>

              <div className="ai-form-section">
                <label className="ai-form-label">{t('mcp_args')}</label>
                <textarea className="settings-input ai-form-textarea"
                  value={editForm.args.join('\n')}
                  onChange={e => updateArgs(e.target.value)}
                  placeholder={"-y\n@modelcontextprotocol/server-filesystem\n."}
                  rows={4} />
              </div>

              <div className="ai-form-section">
                <label className="ai-form-label">{t('mcp_env')}</label>
                <textarea className="settings-input ai-form-textarea"
                  value={Object.entries(editForm.env).map(([k, v]) => `${k}=${v}`).join('\n')}
                  onChange={e => updateEnv(e.target.value)}
                  placeholder="GITHUB_TOKEN=ghp_xxx"
                  rows={3} />
              </div>

              <div className="ai-form-section">
                <label className="ai-form-label">{t('mcp_sync_targets')}</label>
                <div className="ai-app-toggles">
                  {(['claude', 'codex', 'gemini', 'opencode'] as const).map(app => (
                    <label key={app} className="ai-app-toggle">
                      <input type="checkbox" checked={editForm.syncApps[app]}
                        onChange={e => setEditForm(prev => prev ? {
                          ...prev,
                          syncApps: { ...prev.syncApps, [app]: e.target.checked }
                        } : null)} />
                      <span>{app === 'claude' ? 'Claude Code' : app === 'codex' ? 'Codex' : app === 'gemini' ? 'Gemini CLI' : 'OpenCode'}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="ai-form-section">
                <label className="ai-form-label">{t('mcp_enabled')}</label>
                <label className="ai-app-toggle">
                  <input type="checkbox" checked={editForm.enabled}
                    onChange={e => setEditForm(prev => prev ? { ...prev, enabled: e.target.checked } : null)} />
                  <span>{editForm.enabled ? t('mcp_status_enabled') : t('mcp_status_disabled')}</span>
                </label>
              </div>
            </div>
          </>
        ) : (
          <div className="ai-config-empty">
            <h3>{t('mcp_no_servers')}</h3>
            <p>{t('mcp_no_servers_desc')}</p>
          </div>
        )}
      </div>
    </div>
  );
};
