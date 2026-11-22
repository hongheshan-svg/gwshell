import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  TestTube2,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  compatibleProviderLabels,
  findAiModelPreset,
  getAiModelDisplayName,
  providerDefaults,
} from '../../lib/aiModels';
import type { AiProviderSettings } from '../../types/agent';

interface Props {
  settings: AiProviderSettings;
  apiKey: string;
  status: { kind: 'off' | 'warn' | 'ok'; label: string };
  keyPlaceholder: string;
  usable: boolean;
  isDirty: boolean;
  busy: boolean;
  testing: boolean;
  fetchingModels: boolean;
  fetchedModels: string[];
  message: { kind: 'ok' | 'err'; text: string } | null;
  onSettingsChange: (partial: Partial<AiProviderSettings>) => void;
  onApiKeyChange: (value: string) => void;
  onSelectProvider: (provider: AiProviderSettings['provider']) => void;
  onFetchModels: () => void;
  onClearKey: () => void;
  onTest: () => void;
  onSave: () => void;
}

export const AiConnectionConfig: React.FC<Props> = ({
  settings,
  apiKey,
  status,
  keyPlaceholder,
  usable,
  isDirty,
  busy,
  testing,
  fetchingModels,
  fetchedModels,
  message,
  onSettingsChange,
  onApiKeyChange,
  onSelectProvider,
  onFetchModels,
  onClearKey,
  onTest,
  onSave,
}) => {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const selectedPreset = findAiModelPreset(settings);

  const filteredModels = useMemo(() => {
    const q = modelFilter.trim().toLowerCase();
    if (!q) return fetchedModels;
    return fetchedModels.filter((m) => m.toLowerCase().includes(q));
  }, [fetchedModels, modelFilter]);

  return (
    <>
      {/* Hero Status Card */}
      <section className="ai-card ai-hero-card">
        <div className="ai-hero-left">
          <div className={`ai-hero-emblem is-${status.kind}`}>
            <Bot size={20} />
          </div>
          <div className="ai-hero-info">
            <div className="ai-hero-title-row">
              <strong>{getAiModelDisplayName(settings)}</strong>
              <span className={`ai-status-badge is-${status.kind}`} aria-live="polite">
                <span className="ai-status-badge-dot" />
                {status.label}
              </span>
              {isDirty && (
                <span className="ai-status-badge is-warn">
                  <span className="ai-status-badge-dot" />
                  {t('ai_unsaved_changes')}
                </span>
              )}
            </div>
            <div className="ai-hero-sub">
              <span>
                {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
                {selectedPreset?.vendor || compatibleProviderLabels[settings.provider]}
              </span>
              <span className="ai-hero-sep">·</span>
              <code>{settings.model || '-'}</code>
            </div>
          </div>
        </div>

        <label className="ai-hero-toggle">
          <span>{t('agent_ai_enable_model')}</span>
          <button
            className={`settings-toggle ${settings.enabled ? 'on' : ''}`}
            disabled={busy}
            onClick={() => onSettingsChange({ enabled: !settings.enabled })}
            type="button"
          >
            <span className="settings-toggle-knob" />
          </button>
        </label>
      </section>

      {/* Connection & Credentials Card */}
      <section className="ai-card ai-conn-card">
        <div className="ai-card-header">
          <div className="ai-card-heading">
            <PlugZap size={14} />
            <span>{t('agent_ai_compat_title')}</span>
          </div>
          <div className="ai-proto-switch" role="tablist">
            {/* eslint-disable-next-line no-restricted-syntax */}
            {(Object.keys(providerDefaults) as AiProviderSettings['provider'][]).map((provider) => (
              <button
                className={`ai-proto-btn${settings.provider === provider ? ' is-active' : ''}`}
                disabled={busy}
                key={provider}
                onClick={() => onSelectProvider(provider)}
                role="tab"
                aria-selected={settings.provider === provider}
                type="button"
              >
                {compatibleProviderLabels[provider]}
              </button>
            ))}
          </div>
        </div>

        <div className="ai-form-grid">
          <label className="ai-form-field ai-form-field--full">
            <span className="ai-form-label">{t('agent_ai_base_url')}</span>
            <input
              className="settings-input ai-mono-input"
              disabled={busy}
              value={settings.base_url}
              placeholder="https://api.openai.com/v1"
              onChange={(e) => onSettingsChange({ base_url: e.target.value })}
            />
          </label>

          <div className="ai-form-field">
            <div className="ai-form-label-row">
              <span className="ai-form-label">{t('agent_ai_model')}</span>
              <button
                type="button"
                className="ai-inline-action-btn"
                disabled={busy || fetchingModels || !settings.base_url.trim()}
                onClick={onFetchModels}
                title={t('ai_fetch_models_title')}
              >
                {fetchingModels ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />}
                <span>{t('ai_fetch_models')}</span>
              </button>
            </div>
            <input
              className="settings-input ai-mono-input"
              disabled={busy}
              value={settings.model}
              placeholder="gpt-6.2-sol"
              onChange={(e) => onSettingsChange({ model: e.target.value })}
            />
          </div>

          <div className="ai-form-field">
            <div className="ai-form-label-row">
              <span className="ai-form-label">{t('agent_ai_api_key')}</span>
              <span
                className={`ai-key-state ${
                  settings.provider === 'ollama'
                    ? 'is-opt'
                    : settings.api_key_configured
                      ? 'is-ok'
                      : 'is-missing'
                }`}
              >
                {settings.provider === 'ollama'
                  ? t('agent_ai_key_optional')
                  : settings.api_key_configured
                    ? t('agent_ai_key_configured')
                    : t('agent_ai_key_missing')}
              </span>
            </div>
            <div className="ai-key-input-wrap">
              <input
                className="settings-input ai-mono-input"
                disabled={busy}
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder={
                  settings.provider === 'ollama'
                    ? t('agent_ai_key_optional')
                    : settings.api_key_configured
                      ? '••••••••••••••••'
                      : keyPlaceholder
                }
              />
              <button
                type="button"
                className="ai-key-icon-btn"
                onClick={() => setShowKey((v) => !v)}
                tabIndex={-1}
                aria-label="toggle key visibility"
              >
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              {settings.api_key_configured && (
                <button
                  type="button"
                  className="ai-key-icon-btn ai-key-icon-btn--danger"
                  disabled={busy}
                  onClick={onClearKey}
                  title={t('agent_ai_clear_key')}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Live fetched models picker */}
        {fetchedModels.length > 0 && (
          <div className="ai-fetched-drawer">
            <div className="ai-fetched-header">
              <span>{t('ai_pick_fetched_model', { count: fetchedModels.length })}</span>
              {fetchedModels.length > 8 && (
                <div className="ai-fetched-search">
                  <Search size={11} />
                  <input
                    value={modelFilter}
                    onChange={(e) => setModelFilter(e.target.value)}
                    placeholder="Filter..."
                  />
                </div>
              )}
            </div>
            <div className="ai-fetched-chips">
              {filteredModels.slice(0, 60).map((id) => {
                const isSelected = settings.model.trim() === id;
                return (
                  <button
                    type="button"
                    key={id}
                    className={`ai-fetched-chip${isSelected ? ' is-active' : ''}`}
                    onClick={() => onSettingsChange({ model: id })}
                  >
                    {isSelected && <Check size={11} />}
                    <span>{id}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Collapsible Advanced */}
        <div className="ai-adv-section">
          <button
            className="ai-adv-trigger"
            disabled={busy}
            onClick={() => setAdvancedOpen((v) => !v)}
            type="button"
          >
            {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <SlidersHorizontal size={13} />
            <span>{advancedOpen ? t('agent_ai_advanced') : t('agent_ai_advanced_expand')}</span>
          </button>

          {advancedOpen && (
            <div className="ai-adv-grid">
              <label className="ai-form-field">
                <span className="ai-form-label">{t('agent_ai_timeout')}</span>
                <input
                  className="settings-input"
                  disabled={busy}
                  min={120}
                  type="number"
                  value={settings.request_timeout_secs}
                  onChange={(e) =>
                    onSettingsChange({ request_timeout_secs: parseInt(e.target.value, 10) || 120 })
                  }
                />
              </label>
              <label className="ai-form-field">
                <span className="ai-form-label">{t('agent_ai_max_input')}</span>
                <input
                  className="settings-input"
                  disabled={busy}
                  min={2000}
                  type="number"
                  value={settings.max_input_chars}
                  onChange={(e) =>
                    onSettingsChange({ max_input_chars: parseInt(e.target.value, 10) || 24000 })
                  }
                />
              </label>
              <label className="ai-form-field">
                <span className="ai-form-label">
                  {t('agent_ai_temperature')} ({settings.temperature.toFixed(1)})
                </span>
                <input
                  className="ai-temp-range"
                  disabled={busy}
                  max={2}
                  min={0}
                  step={0.1}
                  type="range"
                  value={settings.temperature}
                  onChange={(e) =>
                    onSettingsChange({ temperature: parseFloat(e.target.value) || 0 })
                  }
                />
              </label>
            </div>
          )}
        </div>

        {/* Inline Result Banner */}
        {message && (
          <div className={`ai-result-banner is-${message.kind}`}>
            {message.kind === 'ok' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>{message.text}</span>
          </div>
        )}

        {/* Action Bar */}
        <div className="ai-conn-footer">
          <span className="ai-privacy-hint">
            {usable ? <CheckCircle2 size={13} /> : <KeyRound size={13} />}
            <span>{t('agent_ai_external_notice')}</span>
          </span>
          <div className="ai-conn-actions">
            <button
              className="settings-btn-outline"
              disabled={busy || testing}
              onClick={onTest}
              type="button"
            >
              {testing ? <Loader2 size={13} className="spin" /> : <TestTube2 size={13} />}
              <span>{t('agent_ai_test')}</span>
            </button>
            <button
              className="settings-btn-primary"
              disabled={busy || testing}
              onClick={onSave}
              type="button"
            >
              <Save size={13} />
              <span>{settings.enabled ? t('agent_ai_save_enable') : t('agent_ai_save')}</span>
            </button>
          </div>
        </div>
      </section>
    </>
  );
};
