import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus, Trash2, Zap, Download, Check, Globe, Key, Server,
  Eye, EyeOff, Copy, Pencil, ArrowLeft, Search, X, GripVertical,
  Power, ChevronDown, Star, ExternalLink, Layers, RefreshCw,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { TranslationKeys } from '../../i18n';
import {
  APP_PRESETS, UNIVERSAL_PRESETS as UNIVERSAL_PRESET_LIST,
  PRESET_CATEGORY_ORDER,
  setApiKey, extractBaseUrl,
  type AppPreset, type PresetCategory, type AppKey,
} from '../../config/providerPresets';

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
  settingsConfig?: Record<string, any>;
  category?: string;
  websiteUrl?: string;
  notes?: string;
  icon?: string;
  iconColor?: string;
  enabled: boolean;
  isPartner?: boolean;
  customHeaders?: Record<string, string>;
  createdAt?: number;
  sortIndex?: number;
}

/* ---- CC Switch app definitions (matches AppSwitcher.tsx) ---- */
const APP_LIST: { id: AppKey; name: string; color: string; iconName: string }[] = [
  { id: 'claude', name: 'Claude', color: '#D97757', iconName: 'claude' },
  { id: 'codex', name: 'Codex', color: '#10A37F', iconName: 'codex' },
  { id: 'gemini', name: 'Gemini', color: '#4285F4', iconName: 'gemini' },
  { id: 'opencode', name: 'OpenCode', color: '#8B5CF6', iconName: 'opencode' },
  { id: 'openclaw', name: 'OpenClaw', color: '#EC4899', iconName: 'openclaw' },
];

const APP_COLORS: Record<AppKey, string> = {
  claude: '#D97757', codex: '#10A37F', gemini: '#4285F4', opencode: '#8B5CF6', openclaw: '#EC4899',
};

/* ---- Brand Icons (matching CC Switch ProviderIcon.tsx / BrandIcons.tsx) ---- */
const AppIcon: React.FC<{ app: string; size?: number }> = ({ app, size = 16 }) => {
  switch (app) {
    case 'claude':
      return (
        <svg width={size} height={size} viewBox="0 0 46 32" fill="none">
          <path d="M28.788.001H33.5l-17.96 31.998h-4.713L28.788 0Z" fill="#D97757" />
          <path d="M17.219.001h4.713L3.971 31.999H-.001L17.22.001Z" fill="#D97757" />
        </svg>
      );
    case 'codex':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.143-.08 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.496 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.143.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.085a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
        </svg>
      );
    case 'gemini':
      return (
        <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
          <path d="M14 28C14 21.373 8.627 16 2 16v-4c6.627 0 12-5.373 12-12h4c0 6.627 5.373 12 12 12v4c-6.627 0-12 5.373-12 12h-4Z" fill="#4285F4" />
        </svg>
      );
    case 'opencode':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case 'openclaw':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#EC4899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
        </svg>
      );
    default:
      return <Zap size={size} />;
  }
};

/** Get initials for ProviderIcon fallback (matching CC Switch ProviderIcon.tsx) */
function getInitials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

/* ---- Presets (imported from config/providerPresets.ts — CC Switch faithful replica) ---- */

function newProvider(): AiProvider {
  return {
    id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '', providerType: 'custom', baseUrl: '', apiKey: '',
    apps: { claude: true, codex: true, gemini: true, opencode: true, openclaw: true },
    models: {}, enabled: false, createdAt: Date.now(),
  };
}

/* ============================================================
 * ProviderEditor — CC Switch faithful replica
 * Layout: Header (AppSwitcher + toolbar) → full-width ProviderList / EditForm
 * Matching: App.tsx + ProviderList.tsx + ProviderCard.tsx + AddProviderDialog.tsx
 * ============================================================ */
interface Props { t: (k: TranslationKeys) => string; }

export const ProviderEditor: React.FC<Props> = ({ t }) => {
  /* ---- state ---- */
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [activeIds, setActiveIds] = useState<Record<AppKey, string | undefined>>({
    claude: undefined, codex: undefined, gemini: undefined, opencode: undefined, openclaw: undefined,
  });
  const [activeApp, setActiveApp] = useState<AppKey>('claude');
  const [editForm, setEditForm] = useState<AiProvider | null>(null);
  const [view, setView] = useState<'list' | 'edit' | 'add'>('list');
  const [addTab, setAddTab] = useState<'app-specific' | 'universal'>('app-specific');
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [selectedUniversalPresetId, setSelectedUniversalPresetId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [configText, setConfigText] = useState('{}'); // raw settingsConfig text for add panel JSON editor
  const [universalFormOpen, setUniversalFormOpen] = useState(false);

  const supportsUniversal = activeApp !== 'opencode' && activeApp !== 'openclaw';

  /* ---- universal providers (filtered from main list) ---- */
  const universalProvidersList = useMemo(() => {
    return providers.filter(p => p.apps.claude && p.apps.codex && p.apps.gemini);
  }, [providers]);

  /* ---- presets for current app tab ---- */
  const activeAppPresets = useMemo(() => APP_PRESETS[activeApp] || [], [activeApp]);

  /* ---- data loading ---- */
  const loadData = useCallback(async () => {
    try {
      const [list, ids] = await Promise.all([
        invoke<AiProvider[]>('list_ai_providers'),
        invoke<[string | null, string | null, string | null, string | null, string | null]>('get_ai_active_ids'),
      ]);
      setProviders(list);
      setActiveIds({
        claude: ids[0] ?? undefined, codex: ids[1] ?? undefined,
        gemini: ids[2] ?? undefined, opencode: ids[3] ?? undefined, openclaw: ids[4] ?? undefined,
      });
    } catch { /* not ready */ }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  /* ---- keyboard: Ctrl+F → search (CC Switch ProviderList.tsx pattern) ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && view === 'list') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape' && view === 'add') {
        setView('list');
        setSelectedPresetId(null);
        setAddTab('app-specific');
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setSearchTerm('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => searchRef.current?.focus());
  }, [searchOpen]);

  /* ---- filtered providers (CC Switch: per-app filter) ---- */
  const filteredProviders = useMemo(() => {
    let list = providers.filter(p => p.apps[activeApp]);
    const kw = searchTerm.trim().toLowerCase();
    if (kw) {
      list = list.filter(p =>
        [p.name, p.baseUrl, p.notes].some(f => f?.toLowerCase().includes(kw)),
      );
    }
    return list;
  }, [providers, activeApp, searchTerm]);

  /* ---- helpers ---- */
  const isActive = (id: string, app: AppKey) => activeIds[app] === id;
  const isCurrent = (p: AiProvider) => isActive(p.id, activeApp);

  const flash = (msg: string) => { setStatus(msg); setTimeout(() => setStatus(''), 2500); };

  /* ---- actions ---- */
  const handleSwitch = async (providerId: string, tool: string) => {
    try {
      await invoke('switch_ai_provider', { providerId, tool });
      flash(t('ai_switch_success'));
      await loadData();
    } catch (e: any) { flash(t('ai_error').replace('{error}', String(e))); }
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke('delete_ai_provider', { providerId: id });
      flash(t('ai_delete_success'));
      if (editForm?.id === id) { setEditForm(null); setView('list'); }
      await loadData();
    } catch (e: any) { flash(t('ai_error').replace('{error}', String(e))); }
  };

  const handleSave = async () => {
    if (!editForm) return;
    try {
      const toSave = { ...editForm };
      // Parse configText into settingsConfig (handles user edits in JSON editor)
      try {
        toSave.settingsConfig = JSON.parse(configText);
      } catch {
        flash(t('ai_invalid_json'));
        return;
      }
      // Sync API key into settingsConfig
      if (toSave.settingsConfig && toSave.apiKey) {
        // Determine which app this provider is primarily for
        const primaryApp = (Object.keys(toSave.apps) as AppKey[]).find(a => toSave.apps[a]) || activeApp;
        toSave.settingsConfig = setApiKey(primaryApp, toSave.settingsConfig, toSave.apiKey);
      }
      await invoke('save_ai_provider', { provider: toSave });
      flash(t('ai_save_success'));
      await loadData();
      setView('list');
    } catch (e: any) { flash(t('ai_error').replace('{error}', String(e))); }
  };

  const handleAdd = (presetIdx?: number) => {
    const p = newProvider();
    if (presetIdx !== undefined && presetIdx >= 0 && presetIdx < activeAppPresets.length) {
      const preset = activeAppPresets[presetIdx];
      p.name = preset.name;
      p.providerType = preset.name.toLowerCase().replace(/\s+/g, '_');
      p.settingsConfig = JSON.parse(JSON.stringify(preset.settingsConfig));
      p.baseUrl = extractBaseUrl(activeApp, preset.settingsConfig);
      p.websiteUrl = preset.websiteUrl;
      p.icon = preset.icon;
      p.iconColor = preset.iconColor;
      p.category = preset.category;
      p.isPartner = preset.isPartner;
      // Sync configText for JSON editor
      setConfigText(JSON.stringify(preset.settingsConfig, null, 2));
      // Set apps: only the current app tab
      p.apps = { claude: activeApp === 'claude', codex: activeApp === 'codex', gemini: activeApp === 'gemini', opencode: activeApp === 'opencode', openclaw: activeApp === 'openclaw' };
    } else {
      setConfigText('{}');
    }
    setEditForm(p);
    setShowApiKey(false);
  };

  const closeAddPanel = () => {
    setView('list');
    setSelectedPresetId(null);
    setSelectedUniversalPresetId(null);
    setAddTab('app-specific');
    setUniversalFormOpen(false);
  };

  const makeUniversalProvider = (provider: AiProvider): AiProvider => ({
    ...provider,
    providerType: provider.providerType === 'custom' ? 'universal' : provider.providerType,
    apps: {
      claude: true,
      codex: true,
      gemini: true,
      opencode: false,
      openclaw: false,
    },
  });

  /* Open Add panel (CC Switch: "+" → FullScreenPanel) */
  const openAddPanel = () => {
    setSelectedPresetId(null);
    setSelectedUniversalPresetId(null);
    setAddTab('app-specific');
    setConfigText('{}');
    setUniversalFormOpen(false);
    const p = newProvider();
    setEditForm(p);
    setShowApiKey(false);
    setView('add');
  };

  /* Handle preset selection in add panel (CC Switch ProviderPresetSelector pill click) */
  const handlePresetSelect = (idx: number) => {
    setSelectedPresetId(String(idx));
    handleAdd(idx);
  };

  const handleUniversalPresetSelect = (presetId: string) => {
    const preset = UNIVERSAL_PRESET_LIST.find(item => item.id === presetId);
    if (!preset) return;
    const next = makeUniversalProvider(newProvider());
    next.name = preset.name;
    next.providerType = preset.providerType;
    next.baseUrl = preset.baseUrl;
    next.websiteUrl = preset.websiteUrl;
    next.icon = preset.icon;
    next.iconColor = preset.iconColor;
    next.models = JSON.parse(JSON.stringify(preset.models));
    setSelectedUniversalPresetId(preset.id);
    setEditForm(next);
  };

  const handleAddTabChange = (tab: 'app-specific' | 'universal') => {
    setAddTab(tab);
    setSelectedPresetId(null);
    setSelectedUniversalPresetId(null);
    const next = newProvider();
    if (tab === 'universal') {
      setEditForm(makeUniversalProvider(next));
    } else {
      setEditForm(next);
    }
    setShowApiKey(false);
  };

  /* Submit from Add panel (CC Switch AddProviderDialog footer → Add button) */
  const handleAddSubmit = async () => {
    if (!editForm) return;
    try {
      const providerToSave = addTab === 'universal' ? makeUniversalProvider(editForm) : { ...editForm };
      if (!providerToSave.name.trim()) {
        flash(t('ai_name_required'));
        return;
      }
      // Parse configText into settingsConfig (handles user edits in JSON editor)
      if (addTab !== 'universal') {
        try {
          providerToSave.settingsConfig = JSON.parse(configText);
        } catch {
          flash(t('ai_invalid_json'));
          return;
        }
      }
      // Sync API key into settingsConfig if present
      if (providerToSave.settingsConfig && providerToSave.apiKey) {
        providerToSave.settingsConfig = setApiKey(activeApp, providerToSave.settingsConfig, providerToSave.apiKey);
      }
      await invoke('save_ai_provider', { provider: providerToSave });
      flash(t('ai_save_success'));
      await loadData();
      closeAddPanel();
    } catch (e: any) { flash(t('ai_error').replace('{error}', String(e))); }
  };

  /* Category label for preset groups (CC Switch ProviderPresetSelector) */
  const getCategoryLabel = (cat: PresetCategory): string => {
    const labels: Record<PresetCategory, string> = {
      official: t('ai_preset_official'),
      cn_official: t('ai_preset_cn_official'),
      cloud_provider: t('ai_preset_cloud_provider'),
      aggregator: t('ai_preset_aggregator'),
      third_party: t('ai_preset_third_party'),
      custom: t('ai_preset_custom'),
    };
    return labels[cat];
  };

  /* Grouped presets by category (CC Switch ProviderPresetSelector groupedPresets) */
  const groupedPresets = useMemo(() => {
    const map: Record<PresetCategory, { preset: AppPreset; idx: number }[]> = {
      official: [], cn_official: [], cloud_provider: [], aggregator: [], third_party: [], custom: [],
    };
    activeAppPresets.forEach((p, idx) => {
      if (map[p.category]) map[p.category].push({ preset: p, idx });
    });
    return map;
  }, [activeAppPresets]);

  const handleImport = async () => {
    try {
      const imported = await invoke<AiProvider[]>('import_from_cc_switch');
      if (imported.length === 0) { flash(t('ai_import_empty')); return; }
      for (const p of imported) await invoke('save_ai_provider', { provider: p });
      flash(`${t('ai_import_success')} (${imported.length})`);
      await loadData();
    } catch (e: any) { flash(t('ai_error').replace('{error}', String(e))); }
  };

  const openEdit = (p: AiProvider) => {
    setEditForm({ ...p });
    setConfigText(JSON.stringify(p.settingsConfig ?? {}, null, 2));
    setShowApiKey(false);
    setView('edit');
  };

  const updateForm = <K extends keyof AiProvider>(key: K, value: AiProvider[K]) => {
    setEditForm(prev => prev ? { ...prev, [key]: value } : null);
  };

  const renderModelSections = (provider: AiProvider) => (
    <>
      {provider.apps.claude && (
        <div className="ccs-model-group" style={{ '--group-color': APP_COLORS.claude } as React.CSSProperties}>
          <div className="ccs-model-group-title"><AppIcon app="claude" size={14} /> {t('ai_model_claude')}</div>
          <div className="ccs-form-field">
            <label className="ccs-form-label">{t('ai_model')}</label>
            <input className="ccs-form-input" value={provider.models.claude?.model ?? ''}
              onChange={e => updateForm('models', { ...provider.models, claude: { ...provider.models.claude, model: e.target.value } })}
              placeholder="claude-sonnet-4-20250514" />
          </div>
          <div className="ccs-form-field">
            <label className="ccs-form-label">{t('ai_model_sonnet')}</label>
            <input className="ccs-form-input" value={provider.models.claude?.sonnetModel ?? ''}
              onChange={e => updateForm('models', { ...provider.models, claude: { ...provider.models.claude, sonnetModel: e.target.value } })}
              placeholder="claude-sonnet-4-20250514" />
          </div>
          <div className="ccs-form-field">
            <label className="ccs-form-label">{t('ai_model_haiku')}</label>
            <input className="ccs-form-input" value={provider.models.claude?.haikuModel ?? ''}
              onChange={e => updateForm('models', { ...provider.models, claude: { ...provider.models.claude, haikuModel: e.target.value } })}
              placeholder="claude-haiku-3-5-20241022" />
          </div>
          <div className="ccs-form-field">
            <label className="ccs-form-label">{t('ai_model_opus')}</label>
            <input className="ccs-form-input" value={provider.models.claude?.opusModel ?? ''}
              onChange={e => updateForm('models', { ...provider.models, claude: { ...provider.models.claude, opusModel: e.target.value } })}
              placeholder="claude-sonnet-4-20250514" />
          </div>
        </div>
      )}

      {provider.apps.codex && (
        <div className="ccs-model-group" style={{ '--group-color': APP_COLORS.codex } as React.CSSProperties}>
          <div className="ccs-model-group-title"><AppIcon app="codex" size={14} /> {t('ai_model_codex')}</div>
          <div className="ccs-form-field">
            <label className="ccs-form-label">{t('ai_model')}</label>
            <input className="ccs-form-input" value={provider.models.codex?.model ?? ''}
              onChange={e => updateForm('models', { ...provider.models, codex: { ...provider.models.codex, model: e.target.value } })}
              placeholder="gpt-4o" />
          </div>
          <div className="ccs-form-field">
            <label className="ccs-form-label">{t('ai_reasoning_effort')}</label>
            <div className="ccs-select-wrap">
              <select className="ccs-form-input ccs-form-select"
                value={provider.models.codex?.reasoningEffort ?? 'high'}
                onChange={e => updateForm('models', { ...provider.models, codex: { ...provider.models.codex, reasoningEffort: e.target.value } })}>
                <option value="low">{t('ai_reasoning_low')}</option>
                <option value="medium">{t('ai_reasoning_medium')}</option>
                <option value="high">{t('ai_reasoning_high')}</option>
              </select>
              <ChevronDown size={14} className="ccs-select-arrow" />
            </div>
          </div>
        </div>
      )}

      {provider.apps.gemini && (
        <div className="ccs-model-group" style={{ '--group-color': APP_COLORS.gemini } as React.CSSProperties}>
          <div className="ccs-model-group-title"><AppIcon app="gemini" size={14} /> {t('ai_model_gemini')}</div>
          <div className="ccs-form-field">
            <label className="ccs-form-label">{t('ai_model')}</label>
            <input className="ccs-form-input" value={provider.models.gemini?.model ?? ''}
              onChange={e => updateForm('models', { ...provider.models, gemini: { model: e.target.value } })}
              placeholder="gemini-2.5-pro" />
          </div>
        </div>
      )}

      {provider.apps.opencode && (
        <div className="ccs-model-group" style={{ '--group-color': APP_COLORS.opencode } as React.CSSProperties}>
          <div className="ccs-model-group-title"><AppIcon app="opencode" size={14} /> {t('ai_model_opencode')}</div>
          <div className="ccs-form-field">
            <label className="ccs-form-label">{t('ai_model')}</label>
            <input className="ccs-form-input" value={provider.models.opencode?.model ?? ''}
              onChange={e => updateForm('models', { ...provider.models, opencode: { model: e.target.value } })}
              placeholder="gpt-4o" />
          </div>
        </div>
      )}

      {provider.apps.openclaw && (
        <div className="ccs-model-group" style={{ '--group-color': APP_COLORS.openclaw } as React.CSSProperties}>
          <div className="ccs-model-group-title"><AppIcon app="openclaw" size={14} /> {t('ai_model_openclaw')}</div>
          <div className="ccs-form-field">
            <label className="ccs-form-label">{t('ai_model')}</label>
            <input className="ccs-form-input" value={provider.models.openclaw?.model ?? ''}
              onChange={e => updateForm('models', { ...provider.models, openclaw: { model: e.target.value } })}
              placeholder="gpt-4o" />
          </div>
        </div>
      )}
    </>
  );

  /* ==== RENDER ==== */
  return (
    <div className="ccs-root">
      {/* ═══ Header: AppSwitcher + Actions (CC Switch App.tsx header pattern) ═══ */}
      <div className="ccs-header">
        {view === 'list' ? (
          <>
            {/* AppSwitcher — inline-flex bg-muted rounded-xl p-1 gap-1 (CC Switch AppSwitcher.tsx) */}
            <div className="ccs-app-switcher">
              {APP_LIST.map(app => (
                <button
                  key={app.id}
                  className={`ccs-app-btn${activeApp === app.id ? ' active' : ''}`}
                  onClick={() => setActiveApp(app.id)}
                >
                  <AppIcon app={app.iconName} size={18} />
                  <span className="ccs-app-btn-label">{app.name}</span>
                </button>
              ))}
            </div>

            {/* Toolbar: Search + Import + Add (CC Switch toolbar buttons) */}
            <div className="ccs-toolbar-actions">
              <button className="ccs-toolbar-btn" onClick={() => setSearchOpen(!searchOpen)} title={t('ai_search_title')}>
                <Search size={15} />
              </button>
              <button className="ccs-toolbar-btn" onClick={handleImport} title={t('ai_import_ccswitch')}>
                <Download size={15} />
              </button>
              <button className="ccs-toolbar-btn ccs-add-primary" onClick={openAddPanel} title={t('ai_add')}>
                <Plus size={16} />
              </button>
            </div>
          </>
        ) : view === 'edit' ? (
          /* Edit view header — Back + title (CC Switch FullScreenPanel pattern) */
          <div className="ccs-edit-header">
            <button className="ccs-back-btn" onClick={() => setView('list')}>
              <ArrowLeft size={16} />
            </button>
            <h2 className="ccs-edit-title">{editForm?.name || t('ai_new_provider')}</h2>
            <div className="ccs-toolbar-actions">
              <button className="ccs-save-btn" onClick={handleSave}>
                <Check size={14} /> {t('common_save')}
              </button>
              {editForm && providers.find(p => p.id === editForm.id) && (
                <button className="ccs-delete-btn" onClick={() => handleDelete(editForm.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Add view header */
          <div className="ccs-edit-header">
            <button className="ccs-back-btn" onClick={universalFormOpen ? () => setUniversalFormOpen(false) : closeAddPanel}>
              <ArrowLeft size={16} />
            </button>
            <h2 className="ccs-edit-title">
              {universalFormOpen ? t('ai_add_universal') : t('ai_add_new_provider')}
            </h2>
            <div className="ccs-toolbar-actions">
              {(!supportsUniversal || addTab === 'app-specific') ? (
                <button className="ccs-save-btn" onClick={handleAddSubmit}>
                  <Plus size={14} /> {t('ai_add')}
                </button>
              ) : universalFormOpen ? (
                <button className="ccs-save-btn" onClick={handleAddSubmit}>
                  <Plus size={14} /> {t('ai_add')}
                </button>
              ) : (
                <button className="ccs-save-btn" onClick={() => {
                  const p = makeUniversalProvider(newProvider());
                  setEditForm(p);
                  setShowApiKey(false);
                  setUniversalFormOpen(true);
                }}>
                  <Plus size={14} /> {t('ai_add_universal')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ═══ Search overlay (CC Switch ProviderList.tsx Ctrl+F pattern) ═══ */}
      {searchOpen && view === 'list' && (
        <div className="ccs-search-bar">
          <Search size={14} className="ccs-search-icon" />
          <input
            ref={searchRef}
            className="ccs-search-input"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder={t('ai_search_placeholder')}
          />
          {searchTerm && (
            <button className="ccs-search-clear" onClick={() => setSearchTerm('')}>
              {t('ai_clear')}
            </button>
          )}
          <button className="ccs-search-close" onClick={() => { setSearchOpen(false); setSearchTerm(''); }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ═══ Status toast ═══ */}
      {status && <div className="ccs-status-toast">{status}</div>}

      {/* ═══ Content: Full-width List or Edit Form ═══ */}
      <div className="ccs-content">
        {view === 'list' ? (
          /* ===== PROVIDER LIST (CC Switch ProviderList.tsx) ===== */
          filteredProviders.length === 0 ? (
            <div className="ccs-empty-state">
              <div className="ccs-empty-icon"><Server size={32} /></div>
              <h3>{t('ai_no_providers')}</h3>
              <p>{t('settings_ai_no_config_desc')}</p>
              <button className="ccs-empty-add" onClick={openAddPanel}>
                <Plus size={14} /> {t('ai_add')}
              </button>
            </div>
          ) : (
            <div className="ccs-card-list">
              {filteredProviders.map(p => {
                const current = isCurrent(p);
                return (
                  <div
                    key={p.id}
                    className={`ccs-card${current ? ' current' : ''}`}
                  >
                    {/* Gradient overlay (CC Switch: absolute inset-0 bg-gradient-to-r from-blue-500/10) */}
                    <div className={`ccs-card-gradient${current ? ' visible' : ''}`} />

                    {/* Drag handle (CC Switch: GripVertical h-4 w-4) */}
                    <div className="ccs-card-drag">
                      <GripVertical size={14} />
                    </div>

                    {/* Provider Icon (CC Switch: h-8 w-8 rounded-lg bg-muted flex items-center justify-center) */}
                    <div className="ccs-card-icon" style={p.iconColor ? { borderColor: p.iconColor, color: p.iconColor } : undefined}>
                      {getInitials(p.name || '?')}
                    </div>

                    {/* Info: name + URL (CC Switch: space-y-1 + text-base font-semibold + text-sm text-blue-500) */}
                    <div className="ccs-card-info" onClick={() => handleSwitch(p.id, activeApp)}>
                      <div className="ccs-card-name-row">
                        <h3 className="ccs-card-name">{p.name || t('ai_new_provider')}</h3>
                        {p.isPartner && (
                          <span className="ccs-card-partner-badge"><Star size={10} /></span>
                        )}
                        {current && (
                          <span className="ccs-card-active-badge">
                            {t('ai_active')}
                          </span>
                        )}
                      </div>
                      <div className="ccs-card-url">
                        {p.notes?.trim() || p.baseUrl || '—'}
                      </div>
                    </div>

                    {/* Right: app badges + hover actions (CC Switch ProviderCard.tsx) */}
                    <div className="ccs-card-right">
                      <div className="ccs-card-app-badges">
                        {(Object.keys(p.apps) as AppKey[]).filter(app => p.apps[app]).map(app => (
                          <span
                            key={app}
                            className={`ccs-app-badge${isActive(p.id, app) ? ' active' : ''}`}
                            style={{ '--badge-color': APP_COLORS[app] } as React.CSSProperties}
                            onClick={() => handleSwitch(p.id, app)}
                            title={APP_LIST.find(a => a.id === app)?.name}
                          >
                            <AppIcon app={app} size={10} />
                          </span>
                        ))}
                      </div>

                      {/* Action buttons (CC Switch: opacity-0 group-hover:opacity-100) */}
                      <div className="ccs-card-actions">
                        {!current && (
                          <button
                            className="ccs-card-action-btn enable"
                            onClick={() => handleSwitch(p.id, activeApp)}
                            title={t('ai_quick_switch')}
                          >
                            <Power size={12} />
                          </button>
                        )}
                        <button className="ccs-card-action-btn" onClick={() => openEdit(p)} title={t('ai_edit')}>
                          <Pencil size={12} />
                        </button>
                        <button className="ccs-card-action-btn delete" onClick={() => handleDelete(p.id)} title={t('ai_delete')}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : editForm ? (
          view === 'edit' ? (
          /* ===== EDIT FORM (CC Switch EditProviderDialog / ProviderForm pattern) ===== */
          <div className="ccs-form">
            {/* Basic info */}
            <div className="ccs-form-field">
              <label className="ccs-form-label">{t('ai_name')}</label>
              <input className="ccs-form-input" value={editForm.name}
                onChange={e => updateForm('name', e.target.value)}
                placeholder={t('ai_name_placeholder')} />
            </div>

            <div className="ccs-form-field">
              <label className="ccs-form-label">{t('ai_preset')}</label>
              <div className="ccs-select-wrap">
                <select className="ccs-form-input ccs-form-select" value={editForm.providerType}
                  onChange={e => {
                    const idx = activeAppPresets.findIndex(p => p.name.toLowerCase().replace(/\s+/g, '_') === e.target.value);
                    if (idx >= 0) {
                      const preset = activeAppPresets[idx];
                      updateForm('providerType', preset.name.toLowerCase().replace(/\s+/g, '_'));
                      updateForm('baseUrl', extractBaseUrl(activeApp, preset.settingsConfig));
                      updateForm('websiteUrl', preset.websiteUrl);
                      updateForm('iconColor', preset.iconColor);
                      updateForm('settingsConfig', JSON.parse(JSON.stringify(preset.settingsConfig)));
                      setConfigText(JSON.stringify(preset.settingsConfig, null, 2));
                    } else { updateForm('providerType', e.target.value); }
                  }}>
                  <option value="custom">{t('ai_preset_custom')}</option>
                  {activeAppPresets.map(pr => <option key={pr.name} value={pr.name.toLowerCase().replace(/\s+/g, '_')}>{pr.name}</option>)}
                </select>
                <ChevronDown size={14} className="ccs-select-arrow" />
              </div>
            </div>

            <div className="ccs-form-field">
              <label className="ccs-form-label"><Globe size={12} /> {t('ai_base_url')}</label>
              <div className="ccs-input-with-action">
                <input className="ccs-form-input" value={editForm.baseUrl}
                  onChange={e => updateForm('baseUrl', e.target.value)}
                  placeholder="https://api.example.com" />
                {editForm.baseUrl && (
                  <button className="ccs-inline-btn" onClick={() => navigator.clipboard.writeText(editForm.baseUrl)} title={t('ai_copy')}>
                    <Copy size={12} />
                  </button>
                )}
              </div>
            </div>

            <div className="ccs-form-field">
              <label className="ccs-form-label"><Key size={12} /> {t('ai_api_key')}</label>
              <div className="ccs-input-with-action">
                <input className="ccs-form-input" type={showApiKey ? 'text' : 'password'}
                  value={editForm.apiKey}
                  onChange={e => updateForm('apiKey', e.target.value)}
                  placeholder="sk-..." />
                <button className="ccs-inline-btn" onClick={() => setShowApiKey(!showApiKey)}>
                  {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </div>

            {/* App toggles (CC Switch: chip toggles) */}
            <div className="ccs-form-field">
              <label className="ccs-form-label"><Server size={12} /> {t('ai_target_apps')}</label>
              <div className="ccs-app-toggles">
                {(Object.keys(editForm.apps) as AppKey[]).map(app => (
                  <label key={app} className={`ccs-app-chip${editForm.apps[app] ? ' on' : ''}`}
                    style={{ '--chip-color': APP_COLORS[app] } as React.CSSProperties}>
                    <input type="checkbox" checked={editForm.apps[app]}
                      onChange={e => updateForm('apps', { ...editForm.apps, [app]: e.target.checked })} />
                    <AppIcon app={app} size={14} />
                    <span>{APP_LIST.find(a => a.id === app)?.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Per-app model config (CC Switch style: colored left border group) */}
            {renderModelSections(editForm)}

            {/* Settings Config JSON Editor (CC Switch: always visible) */}
            <div className="ccs-form-field">
              <label className="ccs-form-label">{t('ai_config_json')}</label>
              <textarea
                className="ccs-form-input ccs-form-textarea ccs-json-editor"
                value={configText}
                onChange={e => {
                  setConfigText(e.target.value);
                  try {
                    const parsed = JSON.parse(e.target.value);
                    updateForm('settingsConfig', parsed);
                  } catch {
                    // Allow typing invalid JSON — parse on save
                  }
                }}
                rows={12}
                spellCheck={false}
              />
            </div>

            {/* Notes */}
            <div className="ccs-form-field">
              <label className="ccs-form-label">{t('ai_notes')}</label>
              <textarea className="ccs-form-input ccs-form-textarea"
                value={editForm.notes ?? ''}
                onChange={e => updateForm('notes', e.target.value)}
                placeholder={t('ai_notes_placeholder')} rows={3} />
            </div>

            {/* Quick switch (if provider already saved) */}
            {providers.find(p => p.id === editForm.id) && (
              <div className="ccs-form-field">
                <label className="ccs-form-label"><Zap size={12} /> {t('ai_quick_switch')}</label>
                <div className="ccs-switch-row">
                  {(Object.keys(editForm.apps) as AppKey[]).filter(app => editForm.apps[app]).map(app => (
                    <button key={app}
                      className={`ccs-switch-btn${isActive(editForm.id, app) ? ' active' : ''}`}
                      style={{ '--sw-color': APP_COLORS[app] } as React.CSSProperties}
                      onClick={() => handleSwitch(editForm.id, app)}>
                      <AppIcon app={app} size={13} />
                      <span>{APP_LIST.find(a => a.id === app)?.name}</span>
                      {isActive(editForm.id, app) && <Check size={12} />}
                    </button>
                  ))}
                  <button className="ccs-switch-btn all" onClick={() => handleSwitch(editForm.id, 'all')}>
                    <Zap size={12} /> {t('ai_switch_all')}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ===== ADD FORM (CC Switch AddProviderDialog — inline) ===== */
          <div className="ccs-form">
            {/* Tabs (CC Switch: app-specific + universal) */}
            {supportsUniversal && (
              <div className="ccs-add-tabs">
                <button
                  type="button"
                  className={`ccs-add-tab${addTab === 'app-specific' ? ' active' : ''}`}
                  onClick={() => { handleAddTabChange('app-specific'); setUniversalFormOpen(false); }}
                >
                  {APP_LIST.find(app => app.id === activeApp)?.name} {t('ai_add_tab_provider')}
                </button>
                <button
                  type="button"
                  className={`ccs-add-tab${addTab === 'universal' ? ' active' : ''}`}
                  onClick={() => { handleAddTabChange('universal'); setUniversalFormOpen(false); }}
                >
                  {t('ai_add_tab_universal')}
                </button>
              </div>
            )}

            {(!supportsUniversal || addTab === 'app-specific') ? (
              <>
                {/* ── Preset Selector (CC Switch ProviderPresetSelector: flat pills) ── */}
                <div className="ccs-form-field">
                  <label className="ccs-form-label">{t('ai_preset')}</label>
                  <div className="ccs-preset-flat-pills">
                    {/* "Custom" button first (CC Switch: always first pill) */}
                    <button
                      type="button"
                      className={`ccs-preset-pill${selectedPresetId === 'custom' ? ' selected' : ''}`}
                      onClick={() => { setSelectedPresetId('custom'); const p = newProvider(); p.apps = { claude: activeApp === 'claude', codex: activeApp === 'codex', gemini: activeApp === 'gemini', opencode: activeApp === 'opencode', openclaw: activeApp === 'openclaw' }; setEditForm(p); }}
                    >
                      {t('ai_preset_custom')}
                    </button>
                    {/* All presets flat — iterate by category order but no group headers */}
                    {PRESET_CATEGORY_ORDER.filter(cat => cat !== 'custom').flatMap(cat =>
                      groupedPresets[cat].map(({ preset: pr, idx }) => (
                        <button
                          key={idx}
                          type="button"
                          className={`ccs-preset-pill${selectedPresetId === String(idx) ? ' selected' : ''}${pr.isPartner ? ' partner' : ''}`}
                          style={selectedPresetId === String(idx) && pr.iconColor ? { background: pr.iconColor, borderColor: pr.iconColor, color: '#fff' } : undefined}
                          onClick={() => handlePresetSelect(idx)}
                          title={getCategoryLabel(pr.category)}
                        >
                          {pr.isPartner && <Star size={10} style={{ marginRight: 2 }} />}
                          {pr.name}
                          {pr.websiteUrl && (
                            <ExternalLink size={9} style={{ marginLeft: 3, opacity: 0.5, cursor: 'pointer' }}
                              onClick={e => { e.stopPropagation(); window.open(pr.apiKeyUrl || pr.websiteUrl, '_blank'); }} />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  {/* Dynamic category hint (CC Switch: changes based on selected preset) */}
                  <p className="ccs-preset-hint">{
                    (() => {
                      if (!selectedPresetId || selectedPresetId === 'custom') return t('ai_preset_hint');
                      const idx = parseInt(selectedPresetId);
                      const pr = activeAppPresets[idx];
                      if (!pr) return t('ai_preset_hint');
                      const hints: Record<string, string> = {
                        official: '💡 ' + t('ai_hint_official'),
                        cn_official: '💡 ' + t('ai_hint_cn_official'),
                        cloud_provider: '💡 ' + t('ai_hint_cloud_provider'),
                        aggregator: '💡 ' + t('ai_hint_aggregator'),
                        third_party: '💡 ' + t('ai_hint_third_party'),
                      };
                      return hints[pr.category] || t('ai_preset_hint');
                    })()
                  }</p>
                </div>

                {/* ── Icon (CC Switch BasicFormFields: centered icon indicator) ── */}
                <div className="ccs-icon-preview">
                  <div className="ccs-icon-circle" style={editForm.iconColor ? { borderColor: editForm.iconColor, color: editForm.iconColor } : undefined}>
                    {editForm.icon ? editForm.icon.charAt(0).toUpperCase() : getInitials(editForm.name || '?')}
                  </div>
                </div>

                {/* ── Name + Notes grid (CC Switch BasicFormFields: 2-col grid) ── */}
                <div className="ccs-form-grid">
                  <div className="ccs-form-field">
                    <label className="ccs-form-label">{t('ai_name')}</label>
                    <input className="ccs-form-input" value={editForm.name}
                      onChange={e => updateForm('name', e.target.value)}
                      placeholder={t('ai_name_placeholder')} />
                  </div>
                  <div className="ccs-form-field">
                    <label className="ccs-form-label">{t('ai_notes')}</label>
                    <input className="ccs-form-input" value={editForm.notes ?? ''}
                      onChange={e => updateForm('notes', e.target.value)}
                      placeholder={t('ai_notes_placeholder')} />
                  </div>
                </div>

                {/* ── Website URL (CC Switch BasicFormFields) ── */}
                <div className="ccs-form-field">
                  <label className="ccs-form-label">{t('ai_website_url')}</label>
                  <input className="ccs-form-input" value={editForm.websiteUrl ?? ''}
                    onChange={e => updateForm('websiteUrl', e.target.value)}
                    placeholder="https://provider.example.com" />
                </div>

                {/* ── API Key (CC Switch: shown for non-official categories) ── */}
                {editForm.category !== 'official' && (
                  <div className="ccs-form-field">
                    <label className="ccs-form-label"><Key size={12} /> {t('ai_api_key')}</label>
                    <div className="ccs-input-with-action">
                      <input className="ccs-form-input" type={showApiKey ? 'text' : 'password'}
                        value={editForm.apiKey}
                        onChange={e => updateForm('apiKey', e.target.value)}
                        placeholder="sk-..." />
                      <button type="button" className="ccs-inline-btn" onClick={() => setShowApiKey(!showApiKey)}>
                        {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                      {editForm.websiteUrl && (
                        <button type="button" className="ccs-inline-btn" title={t('ai_get_api_key')}
                          onClick={() => window.open(editForm.websiteUrl, '_blank')}>
                          <ExternalLink size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Base URL (CC Switch: shown for non-official categories) ── */}
                {editForm.category !== 'official' && (
                  <div className="ccs-form-field">
                    <label className="ccs-form-label"><Globe size={12} /> {t('ai_base_url')}</label>
                    <input className="ccs-form-input" value={editForm.baseUrl}
                      onChange={e => updateForm('baseUrl', e.target.value)}
                      placeholder="https://api.example.com" />
                  </div>
                )}

                {/* ── Settings Config JSON Editor (CC Switch: always visible) ── */}
                <div className="ccs-form-field">
                  <label className="ccs-form-label">{t('ai_config_json')}</label>
                  <textarea
                    className="ccs-form-input ccs-form-textarea ccs-json-editor"
                    value={configText}
                    onChange={e => {
                      setConfigText(e.target.value);
                      try {
                        const parsed = JSON.parse(e.target.value);
                        updateForm('settingsConfig', parsed);
                      } catch {
                        // Allow typing invalid JSON — parse on submit
                      }
                    }}
                    rows={12}
                    spellCheck={false}
                  />
                </div>
              </>
            ) : !universalFormOpen ? (
              /* ===== Universal Provider List (CC Switch UniversalProviderPanel) ===== */
              <>
                {/* Header */}
                <div className="ccs-universal-panel-header">
                  <Layers size={20} style={{ color: 'var(--accent-primary)' }} />
                  <h3 className="ccs-universal-panel-title">{t('ai_universal_title')}</h3>
                  <span className="ccs-universal-count">{universalProvidersList.length}</span>
                </div>

                {/* Description */}
                <p className="ccs-universal-panel-desc">{t('ai_universal_desc')}</p>

                {/* Provider list or empty state */}
                {universalProvidersList.length === 0 ? (
                  <div className="ccs-universal-empty">
                    <Layers size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
                    <p>{t('ai_universal_empty')}</p>
                    <p className="ccs-universal-empty-hint">{t('ai_universal_empty_hint')}</p>
                  </div>
                ) : (
                  <div className="ccs-universal-grid">
                    {universalProvidersList.map(p => (
                      <div key={p.id} className="ccs-universal-card">
                        {/* Card header: icon, name, actions */}
                        <div className="ccs-universal-card-top">
                          <div className="ccs-universal-card-icon" style={p.iconColor ? { borderColor: p.iconColor, color: p.iconColor } : undefined}>
                            {getInitials(p.name || '?')}
                          </div>
                          <div className="ccs-universal-card-info">
                            <h4 className="ccs-universal-card-name">{p.name}</h4>
                            <span className="ccs-universal-card-type">{p.providerType}</span>
                          </div>
                          <div className="ccs-universal-card-actions">
                            <button className="ccs-card-action-btn" onClick={() => handleSwitch(p.id, 'all')} title={t('ai_sync')}>
                              <RefreshCw size={14} />
                            </button>
                            <button className="ccs-card-action-btn" onClick={() => { closeAddPanel(); openEdit(p); }} title={t('ai_edit')}>
                              <Pencil size={14} />
                            </button>
                            <button className="ccs-card-action-btn delete" onClick={() => handleDelete(p.id)} title={t('ai_delete')}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {/* Base URL */}
                        <div className="ccs-universal-card-url">
                          <Globe size={14} />
                          <span>{p.baseUrl || '—'}</span>
                        </div>

                        {/* App badges */}
                        <div className="ccs-universal-card-badges">
                          {(Object.keys(p.apps) as AppKey[]).filter(app => p.apps[app]).map(app => (
                            <span key={app} className="ccs-universal-app-badge" style={{ '--badge-color': APP_COLORS[app] } as React.CSSProperties}>
                              {APP_LIST.find(a => a.id === app)?.name}
                            </span>
                          ))}
                        </div>

                        {/* Notes */}
                        {p.notes && <p className="ccs-universal-card-notes">{p.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              /* ===== Universal Provider Add Form (CC Switch UniversalProviderFormModal) ===== */
              <>
                {/* Preset selection */}
                <div className="ccs-form-field">
                  <label className="ccs-form-label">{t('ai_universal_preset')}</label>
                  <div className="ccs-preset-flat-pills">
                    {UNIVERSAL_PRESET_LIST.map(preset => (
                      <button
                        key={preset.id}
                        type="button"
                        className={`ccs-preset-pill${selectedUniversalPresetId === preset.id ? ' selected' : ''}`}
                        style={selectedUniversalPresetId === preset.id && preset.iconColor ? { background: preset.iconColor, borderColor: preset.iconColor, color: '#fff' } : undefined}
                        onClick={() => handleUniversalPresetSelect(preset.id)}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                  {selectedUniversalPresetId && (
                    <p className="ccs-preset-hint">
                      {UNIVERSAL_PRESET_LIST.find(item => item.id === selectedUniversalPresetId)?.description ?? ''}
                    </p>
                  )}
                </div>

                {/* Basic info */}
                <div className="ccs-form-field">
                  <label className="ccs-form-label">{t('ai_name')}</label>
                  <input className="ccs-form-input" value={editForm.name}
                    onChange={e => updateForm('name', e.target.value)}
                    placeholder={t('ai_name_placeholder')} />
                </div>

                <div className="ccs-form-field">
                  <label className="ccs-form-label">{t('ai_base_url')}</label>
                  <input className="ccs-form-input" value={editForm.baseUrl}
                    onChange={e => updateForm('baseUrl', e.target.value)}
                    placeholder="https://api.example.com" />
                </div>

                <div className="ccs-form-field">
                  <label className="ccs-form-label"><Key size={12} /> {t('ai_api_key')}</label>
                  <div className="ccs-input-with-action">
                    <input className="ccs-form-input" type={showApiKey ? 'text' : 'password'}
                      value={editForm.apiKey}
                      onChange={e => updateForm('apiKey', e.target.value)}
                      placeholder="sk-..." />
                    <button type="button" className="ccs-inline-btn" onClick={() => setShowApiKey(!showApiKey)}>
                      {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                </div>

                <div className="ccs-form-field">
                  <label className="ccs-form-label">{t('ai_website_url')}</label>
                  <input className="ccs-form-input" value={editForm.websiteUrl ?? ''}
                    onChange={e => updateForm('websiteUrl', e.target.value)}
                    placeholder="https://example.com" />
                </div>

                <div className="ccs-form-field">
                  <label className="ccs-form-label">{t('ai_notes')}</label>
                  <input className="ccs-form-input" value={editForm.notes ?? ''}
                    onChange={e => updateForm('notes', e.target.value)}
                    placeholder={t('ai_notes_placeholder')} />
                </div>

                {/* App toggles (CC Switch: switch-style toggles) */}
                <div className="ccs-form-field">
                  <label className="ccs-form-label">{t('ai_target_apps')}</label>
                  <div className="ccs-universal-app-toggles">
                    {(['claude', 'codex', 'gemini'] as AppKey[]).map(app => (
                      <div key={app} className="ccs-universal-app-toggle">
                        <div className="ccs-universal-app-toggle-info">
                          <AppIcon app={app} size={20} />
                          <span>{APP_LIST.find(a => a.id === app)?.name}</span>
                        </div>
                        <label className="ccs-toggle-switch">
                          <input type="checkbox" checked={editForm.apps[app]}
                            onChange={e => updateForm('apps', { ...editForm.apps, [app]: e.target.checked })} />
                          <span className="ccs-toggle-slider" />
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Model config per app */}
                {renderModelSections(makeUniversalProvider(editForm))}
              </>
            )}
          </div>
        )) : null}
      </div>
    </div>
  );
};
