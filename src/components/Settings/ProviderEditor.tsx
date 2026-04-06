import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Zap, Download, Check, ChevronDown, Globe, Key, Server } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { TranslationKeys } from '../../i18n';

/* ---- Types matching Rust ai_config.rs ---- */
export interface AiProvider {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  apps: { claude: boolean; codex: boolean; gemini: boolean; opencode: boolean; openclaw: boolean };
  models: {
    claude?: { model?: string; haikuModel?: string; sonnetModel?: string; opusModel?: string };
    codex?: { model?: string; reasoningEffort?: string };
    gemini?: { model?: string };
    opencode?: { model?: string };
    openclaw?: { model?: string };
  };
  websiteUrl?: string;
  notes?: string;
  icon?: string;
  iconColor?: string;
  enabled: boolean;
  customHeaders?: Record<string, string>;
  createdAt?: number;
  sortIndex?: number;
}

/* ---- Presets (ported from cc-switch universalProviderPresets) ---- */
const PROVIDER_PRESETS: { id: string; name: string; baseUrl: string; models: AiProvider['models'] }[] = [
  {
    id: 'newapi', name: 'NewAPI',
    baseUrl: 'https://api.newapi.com',
    models: {
      claude: { model: 'claude-sonnet-4-20250514', sonnetModel: 'claude-sonnet-4-20250514', haikuModel: 'claude-haiku-3-5-20241022', opusModel: 'claude-sonnet-4-20250514' },
      codex: { model: 'gpt-4o', reasoningEffort: 'high' },
      gemini: { model: 'gemini-2.5-pro' },
    },
  },
  {
    id: 'openai', name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    models: { codex: { model: 'gpt-4o', reasoningEffort: 'high' } },
  },
  {
    id: 'anthropic', name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: { claude: { model: 'claude-sonnet-4-20250514', sonnetModel: 'claude-sonnet-4-20250514', haikuModel: 'claude-haiku-3-5-20241022', opusModel: 'claude-sonnet-4-20250514' } },
  },
  {
    id: 'google', name: 'Google AI',
    baseUrl: 'https://generativelanguage.googleapis.com',
    models: { gemini: { model: 'gemini-2.5-pro' } },
  },
  {
    id: 'deepseek', name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: { claude: { model: 'deepseek-chat' }, codex: { model: 'deepseek-chat' } },
  },
  {
    id: 'custom', name: 'Custom',
    baseUrl: '',
    models: {},
  },
];

function newProvider(): AiProvider {
  return {
    id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    providerType: 'custom',
    baseUrl: '',
    apiKey: '',
    apps: { claude: true, codex: true, gemini: true, opencode: true, openclaw: true },
    models: {},
    enabled: false,
    createdAt: Date.now(),
  };
}

interface Props {
  t: (k: TranslationKeys) => string;
}

export const ProviderEditor: React.FC<Props> = ({ t }) => {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [activeIds, setActiveIds] = useState<{ claude?: string; codex?: string; gemini?: string; opencode?: string; openclaw?: string }>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<AiProvider | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [status, setStatus] = useState<string>('');

  const loadData = useCallback(async () => {
    try {
      const [list, ids] = await Promise.all([
        invoke<AiProvider[]>('list_ai_providers'),
        invoke<[string | null, string | null, string | null, string | null, string | null]>('get_ai_active_ids'),
      ]);
      setProviders(list);
      setActiveIds({ claude: ids[0] ?? undefined, codex: ids[1] ?? undefined, gemini: ids[2] ?? undefined, opencode: ids[3] ?? undefined, openclaw: ids[4] ?? undefined });
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0].id);
        setEditForm(list[0]);
      }
    } catch {
      // Store not initialized yet — that's fine
    }
  }, [selectedId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSelect = (p: AiProvider) => {
    setSelectedId(p.id);
    setEditForm({ ...p });
    setShowPresets(false);
  };

  const handleAdd = (presetId?: string) => {
    const p = newProvider();
    if (presetId) {
      const preset = PROVIDER_PRESETS.find(pr => pr.id === presetId);
      if (preset) {
        p.name = preset.name;
        p.providerType = preset.id;
        p.baseUrl = preset.baseUrl;
        p.models = JSON.parse(JSON.stringify(preset.models));
        p.apps = {
          claude: !!preset.models.claude,
          codex: !!preset.models.codex,
          gemini: !!preset.models.gemini,
          opencode: !!preset.models.opencode,
          openclaw: !!preset.models.openclaw,
        };
      }
    }
    setShowPresets(false);
    setSelectedId(p.id);
    setEditForm(p);
  };

  const handleSave = async () => {
    if (!editForm) return;
    try {
      await invoke('save_ai_provider', { provider: editForm });
      setStatus(t('ai_save_success'));
      await loadData();
      setSelectedId(editForm.id);
      const updated = (await invoke<AiProvider[]>('list_ai_providers')).find(p => p.id === editForm.id);
      if (updated) setEditForm(updated);
      setTimeout(() => setStatus(''), 2000);
    } catch (e: any) {
      setStatus(`Error: ${e}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke('delete_ai_provider', { providerId: id });
      setStatus(t('ai_delete_success'));
      if (selectedId === id) {
        setSelectedId(null);
        setEditForm(null);
      }
      await loadData();
      setTimeout(() => setStatus(''), 2000);
    } catch (e: any) {
      setStatus(`Error: ${e}`);
    }
  };

  const handleSwitch = async (providerId: string, tool: string) => {
    try {
      await invoke('switch_ai_provider', { providerId, tool });
      setStatus(t('ai_switch_success'));
      await loadData();
      setTimeout(() => setStatus(''), 2000);
    } catch (e: any) {
      setStatus(`Error: ${e}`);
    }
  };

  const handleImport = async () => {
    try {
      const imported = await invoke<AiProvider[]>('import_from_cc_switch');
      if (imported.length === 0) {
        setStatus(t('ai_import_empty'));
        setTimeout(() => setStatus(''), 2000);
        return;
      }
      for (const p of imported) {
        await invoke('save_ai_provider', { provider: p });
      }
      setStatus(`${t('ai_import_success')} (${imported.length})`);
      await loadData();
      setTimeout(() => setStatus(''), 3000);
    } catch (e: any) {
      setStatus(`Error: ${e}`);
    }
  };

  const updateForm = <K extends keyof AiProvider>(key: K, value: AiProvider[K]) => {
    setEditForm(prev => prev ? { ...prev, [key]: value } : null);
  };

  const isActive = (id: string, tool: string) => {
    if (tool === 'claude') return activeIds.claude === id;
    if (tool === 'codex') return activeIds.codex === id;
    if (tool === 'gemini') return activeIds.gemini === id;
    if (tool === 'opencode') return activeIds.opencode === id;
    if (tool === 'openclaw') return activeIds.openclaw === id;
    return false;
  };

  return (
    <div className="settings-columns" style={{ gap: 0 }}>
      {/* ---- Left: Provider list ---- */}
      <div className="ai-provider-panel">
        <div className="ai-provider-panel-header">
          <h3>{t('ai_providers_title')}</h3>
          <p>{t('ai_providers_desc')}</p>
        </div>

        <div className="ai-provider-toolbar">
          <div className="ai-provider-add-wrap">
            <button className="ai-toolbar-btn" onClick={() => setShowPresets(!showPresets)}>
              <Plus size={13} /> {t('ai_add')}
              <ChevronDown size={11} />
            </button>
            {showPresets && (
              <div className="ai-preset-dropdown">
                {PROVIDER_PRESETS.map(pr => (
                  <button key={pr.id} className="ai-preset-item" onClick={() => handleAdd(pr.id)}>
                    {pr.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="ai-toolbar-btn" onClick={handleImport} title={t('ai_import_ccswitch')}>
            <Download size={13} /> cc-switch
          </button>
        </div>

        <div className="ai-provider-list">
          {providers.map(p => (
            <div
              key={p.id}
              className={`ai-provider-card ${selectedId === p.id ? 'selected' : ''}`}
              onClick={() => handleSelect(p)}
            >
              <div className="ai-provider-card-info">
                <span className="ai-provider-name">{p.name || '(unnamed)'}</span>
                <span className="ai-provider-type">{p.providerType}</span>
              </div>
              <div className="ai-provider-badges">
                {p.apps.claude && (
                  <span className={`ai-badge ${isActive(p.id, 'claude') ? 'active' : ''}`}
                    onClick={e => { e.stopPropagation(); handleSwitch(p.id, 'claude'); }}
                    title="Claude">C</span>
                )}
                {p.apps.codex && (
                  <span className={`ai-badge ${isActive(p.id, 'codex') ? 'active' : ''}`}
                    onClick={e => { e.stopPropagation(); handleSwitch(p.id, 'codex'); }}
                    title="Codex">X</span>
                )}
                {p.apps.gemini && (
                  <span className={`ai-badge ${isActive(p.id, 'gemini') ? 'active' : ''}`}
                    onClick={e => { e.stopPropagation(); handleSwitch(p.id, 'gemini'); }}
                    title="Gemini">G</span>
                )}
                {p.apps.opencode && (
                  <span className={`ai-badge ${isActive(p.id, 'opencode') ? 'active' : ''}`}
                    onClick={e => { e.stopPropagation(); handleSwitch(p.id, 'opencode'); }}
                    title="OpenCode">O</span>
                )}
                {p.apps.openclaw && (
                  <span className={`ai-badge ${isActive(p.id, 'openclaw') ? 'active' : ''}`}
                    onClick={e => { e.stopPropagation(); handleSwitch(p.id, 'openclaw'); }}
                    title="OpenClaw">W</span>
                )}
              </div>
            </div>
          ))}
          {providers.length === 0 && (
            <div className="ai-config-empty" style={{ height: 200 }}>
              <p>{t('ai_no_providers')}</p>
            </div>
          )}
        </div>
      </div>

      {/* ---- Right: Edit form ---- */}
      <div className="settings-col ai-editor-col">
        {editForm ? (
          <>
            <div className="ai-editor-header">
              <h3>{editForm.name || t('ai_new_provider')}</h3>
              <div className="ai-editor-actions">
                <button className="ai-toolbar-btn primary" onClick={handleSave}>
                  <Check size={13} /> {t('common_save')}
                </button>
                {providers.find(p => p.id === editForm.id) && (
                  <button className="ai-toolbar-btn danger" onClick={() => handleDelete(editForm.id)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>

            {status && <div className="ai-status-bar">{status}</div>}

            <div className="ai-form">
              {/* Basic info */}
              <div className="ai-form-section">
                <label className="ai-form-label">{t('ai_name')}</label>
                <input className="settings-input ai-form-input" value={editForm.name} onChange={e => updateForm('name', e.target.value)} placeholder={t('ai_name_placeholder')} />
              </div>

              <div className="ai-form-section">
                <label className="ai-form-label">{t('ai_preset')}</label>
                <select className="settings-select ai-form-input" value={editForm.providerType} onChange={e => {
                  const preset = PROVIDER_PRESETS.find(p => p.id === e.target.value);
                  if (preset) {
                    updateForm('providerType', preset.id);
                    updateForm('baseUrl', preset.baseUrl);
                    updateForm('models', JSON.parse(JSON.stringify(preset.models)));
                    updateForm('apps', {
                      claude: !!preset.models.claude,
                      codex: !!preset.models.codex,
                      gemini: !!preset.models.gemini,
                      opencode: !!preset.models.opencode,
                      openclaw: !!preset.models.openclaw,
                    });
                  } else {
                    updateForm('providerType', e.target.value);
                  }
                }}>
                  {PROVIDER_PRESETS.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                </select>
              </div>

              <div className="ai-form-section">
                <label className="ai-form-label"><Globe size={12} /> {t('ai_base_url')}</label>
                <input className="settings-input ai-form-input" value={editForm.baseUrl} onChange={e => updateForm('baseUrl', e.target.value)} placeholder="https://api.example.com" />
              </div>

              <div className="ai-form-section">
                <label className="ai-form-label"><Key size={12} /> {t('ai_api_key')}</label>
                <input className="settings-input ai-form-input" type="password" value={editForm.apiKey} onChange={e => updateForm('apiKey', e.target.value)} placeholder="sk-..." />
              </div>

              {/* App toggles */}
              <div className="ai-form-section">
                <label className="ai-form-label"><Server size={12} /> {t('ai_target_apps')}</label>
                <div className="ai-app-toggles">
                  {(['claude', 'codex', 'gemini', 'opencode', 'openclaw'] as const).map(app => (
                    <label key={app} className="ai-app-toggle">
                      <input type="checkbox" checked={editForm.apps[app]}
                        onChange={e => updateForm('apps', { ...editForm.apps, [app]: e.target.checked })} />
                      <span>{app === 'claude' ? 'Claude Code' : app === 'codex' ? 'Codex' : app === 'gemini' ? 'Gemini CLI' : app === 'opencode' ? 'OpenCode' : 'OpenClaw'}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Model configs per app */}
              {editForm.apps.claude && (
                <div className="ai-form-group">
                  <div className="ai-form-group-title">Claude Code {t('ai_models')}</div>
                  <div className="ai-form-section">
                    <label className="ai-form-label">{t('ai_model')}</label>
                    <input className="settings-input ai-form-input"
                      value={editForm.models.claude?.model ?? ''}
                      onChange={e => updateForm('models', { ...editForm.models, claude: { ...editForm.models.claude, model: e.target.value } })}
                      placeholder="claude-sonnet-4-20250514" />
                  </div>
                  <div className="ai-form-section">
                    <label className="ai-form-label">Sonnet</label>
                    <input className="settings-input ai-form-input"
                      value={editForm.models.claude?.sonnetModel ?? ''}
                      onChange={e => updateForm('models', { ...editForm.models, claude: { ...editForm.models.claude, sonnetModel: e.target.value } })}
                      placeholder="claude-sonnet-4-20250514" />
                  </div>
                  <div className="ai-form-section">
                    <label className="ai-form-label">Haiku</label>
                    <input className="settings-input ai-form-input"
                      value={editForm.models.claude?.haikuModel ?? ''}
                      onChange={e => updateForm('models', { ...editForm.models, claude: { ...editForm.models.claude, haikuModel: e.target.value } })}
                      placeholder="claude-haiku-3-5-20241022" />
                  </div>
                  <div className="ai-form-section">
                    <label className="ai-form-label">Opus</label>
                    <input className="settings-input ai-form-input"
                      value={editForm.models.claude?.opusModel ?? ''}
                      onChange={e => updateForm('models', { ...editForm.models, claude: { ...editForm.models.claude, opusModel: e.target.value } })}
                      placeholder="claude-sonnet-4-20250514" />
                  </div>
                </div>
              )}

              {editForm.apps.codex && (
                <div className="ai-form-group">
                  <div className="ai-form-group-title">Codex {t('ai_models')}</div>
                  <div className="ai-form-section">
                    <label className="ai-form-label">{t('ai_model')}</label>
                    <input className="settings-input ai-form-input"
                      value={editForm.models.codex?.model ?? ''}
                      onChange={e => updateForm('models', { ...editForm.models, codex: { ...editForm.models.codex, model: e.target.value } })}
                      placeholder="gpt-4o" />
                  </div>
                  <div className="ai-form-section">
                    <label className="ai-form-label">{t('ai_reasoning_effort')}</label>
                    <select className="settings-select ai-form-input"
                      value={editForm.models.codex?.reasoningEffort ?? 'high'}
                      onChange={e => updateForm('models', { ...editForm.models, codex: { ...editForm.models.codex, reasoningEffort: e.target.value } })}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                </div>
              )}

              {editForm.apps.gemini && (
                <div className="ai-form-group">
                  <div className="ai-form-group-title">Gemini CLI {t('ai_models')}</div>
                  <div className="ai-form-section">
                    <label className="ai-form-label">{t('ai_model')}</label>
                    <input className="settings-input ai-form-input"
                      value={editForm.models.gemini?.model ?? ''}
                      onChange={e => updateForm('models', { ...editForm.models, gemini: { model: e.target.value } })}
                      placeholder="gemini-2.5-pro" />
                  </div>
                </div>
              )}

              {editForm.apps.opencode && (
                <div className="ai-form-group">
                  <div className="ai-form-group-title">OpenCode {t('ai_models')}</div>
                  <div className="ai-form-section">
                    <label className="ai-form-label">{t('ai_model')}</label>
                    <input className="settings-input ai-form-input"
                      value={editForm.models.opencode?.model ?? ''}
                      onChange={e => updateForm('models', { ...editForm.models, opencode: { model: e.target.value } })}
                      placeholder="gpt-4o" />
                  </div>
                </div>
              )}

              {editForm.apps.openclaw && (
                <div className="ai-form-group">
                  <div className="ai-form-group-title">OpenClaw {t('ai_models')}</div>
                  <div className="ai-form-section">
                    <label className="ai-form-label">{t('ai_model')}</label>
                    <input className="settings-input ai-form-input"
                      value={editForm.models.openclaw?.model ?? ''}
                      onChange={e => updateForm('models', { ...editForm.models, openclaw: { model: e.target.value } })}
                      placeholder="gpt-4o" />
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="ai-form-section">
                <label className="ai-form-label">{t('ai_notes')}</label>
                <textarea className="settings-input ai-form-textarea" value={editForm.notes ?? ''} onChange={e => updateForm('notes', e.target.value)} placeholder={t('ai_notes_placeholder')} rows={3} />
              </div>

              {/* Quick switch buttons */}
              {providers.find(p => p.id === editForm.id) && (
                <div className="ai-form-section">
                  <label className="ai-form-label"><Zap size={12} /> {t('ai_quick_switch')}</label>
                  <div className="ai-switch-buttons">
                    {editForm.apps.claude && (
                      <button className={`ai-switch-btn ${isActive(editForm.id, 'claude') ? 'active' : ''}`}
                        onClick={() => handleSwitch(editForm.id, 'claude')}>
                        Claude {isActive(editForm.id, 'claude') ? '✓' : ''}
                      </button>
                    )}
                    {editForm.apps.codex && (
                      <button className={`ai-switch-btn ${isActive(editForm.id, 'codex') ? 'active' : ''}`}
                        onClick={() => handleSwitch(editForm.id, 'codex')}>
                        Codex {isActive(editForm.id, 'codex') ? '✓' : ''}
                      </button>
                    )}
                    {editForm.apps.gemini && (
                      <button className={`ai-switch-btn ${isActive(editForm.id, 'gemini') ? 'active' : ''}`}
                        onClick={() => handleSwitch(editForm.id, 'gemini')}>
                        Gemini {isActive(editForm.id, 'gemini') ? '✓' : ''}
                      </button>
                    )}
                    {editForm.apps.opencode && (
                      <button className={`ai-switch-btn ${isActive(editForm.id, 'opencode') ? 'active' : ''}`}
                        onClick={() => handleSwitch(editForm.id, 'opencode')}>
                        OpenCode {isActive(editForm.id, 'opencode') ? '✓' : ''}
                      </button>
                    )}
                    {editForm.apps.openclaw && (
                      <button className={`ai-switch-btn ${isActive(editForm.id, 'openclaw') ? 'active' : ''}`}
                        onClick={() => handleSwitch(editForm.id, 'openclaw')}>
                        OpenClaw {isActive(editForm.id, 'openclaw') ? '✓' : ''}
                      </button>
                    )}
                    <button className="ai-switch-btn all" onClick={() => handleSwitch(editForm.id, 'all')}>
                      {t('ai_switch_all')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="ai-config-empty">
            <h3>{t('settings_ai_no_config')}</h3>
            <p>{t('settings_ai_no_config_desc')}</p>
          </div>
        )}
      </div>
    </div>
  );
};
