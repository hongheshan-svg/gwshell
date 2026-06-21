import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, PlugZap, RotateCcw, Save, SlidersHorizontal, TestTube2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { compatibleProviderLabels, findAiModelPreset, getAiModelDisplayName, providerDefaults } from '../../lib/aiModels';
import type { AiProviderSettings } from '../../types/agent';

interface Props {
  settings: AiProviderSettings;
  apiKey: string;
  status: { kind: 'off' | 'warn' | 'ok'; label: string };
  keyPlaceholder: string;
  usable: boolean;
  busy: boolean;
  message: { kind: 'ok' | 'err'; text: string } | null;
  onSettingsChange: (partial: Partial<AiProviderSettings>) => void;
  onApiKeyChange: (value: string) => void;
  onSelectProvider: (provider: AiProviderSettings['provider']) => void;
  onClearKey: () => void;
  onTest: () => void;
  onSave: () => void;
}

export const AiConnectionConfig: React.FC<Props> = ({
  settings, apiKey, status, keyPlaceholder, usable, busy, message,
  onSettingsChange, onApiKeyChange, onSelectProvider, onClearKey, onTest, onSave,
}) => {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const selectedPreset = findAiModelPreset(settings);
  return (
    <section className="ai-config-panel ai-connection-config">
      {/* Status card */}
      <div className="ai-settings-hero">
        <div className="ai-settings-hero-main">
          <span className="ai-settings-eyebrow">{t('agent_ai_current_model')}</span>
          <div className="ai-settings-model-name">
            <span>{getAiModelDisplayName(settings)}</span>
          </div>
          <div className="ai-settings-model-meta">
            <span>{selectedPreset?.vendor || compatibleProviderLabels[settings.provider]}</span>
            <span>{settings.model || '-'}</span>
          </div>
        </div>
        <div className="ai-settings-hero-actions">
          <div className={`ai-settings-status ${status.kind}`} aria-live="polite">
            {status.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {status.label}
          </div>
          <label className="ai-enable-control">
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
        </div>
      </div>

      {message && (
        <div className={`ai-settings-message ${message.kind}`}>
          {message.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Custom / third-party provider — prominent card */}
      <div className="ai-custom-provider">
        <div className="ai-custom-provider-title">
          <PlugZap size={16} />
          {t('agent_ai_compat_title')}
        </div>
        <p className="ai-custom-provider-hint">{t('agent_ai_compat_hint')}</p>
        <div className="ai-provider-segments">
          {(Object.keys(providerDefaults) as AiProviderSettings['provider'][]).map((provider) => (
            <button
              className={settings.provider === provider ? 'active' : ''}
              disabled={busy}
              key={provider}
              onClick={() => onSelectProvider(provider)}
              type="button"
            >
              {compatibleProviderLabels[provider]}
            </button>
          ))}
        </div>
        <div className="ai-field-grid">
          <label className="ai-field wide">
            <span>{t('agent_ai_base_url')}</span>
            <input
              className="settings-input"
              disabled={busy}
              value={settings.base_url}
              onChange={(e) => onSettingsChange({ base_url: e.target.value })}
            />
          </label>
          <label className="ai-field">
            <span>{t('agent_ai_model')}</span>
            <input
              className="settings-input"
              disabled={busy}
              value={settings.model}
              onChange={(e) => onSettingsChange({ model: e.target.value })}
            />
          </label>
          <label className="ai-field">
            <span>{t('agent_ai_api_key')}</span>
            <input
              className="settings-input"
              disabled={busy}
              type="password"
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder={settings.provider === 'ollama' ? t('agent_ai_key_optional') : keyPlaceholder}
            />
            <small>
              {settings.provider === 'ollama'
                ? t('agent_ai_key_optional')
                : settings.api_key_configured
                  ? t('agent_ai_key_configured')
                  : t('agent_ai_key_missing')}
            </small>
          </label>
        </div>
      </div>

      {/* Collapsible advanced */}
      <button
        className="ai-advanced-toggle"
        disabled={busy}
        onClick={() => setAdvancedOpen((v) => !v)}
        type="button"
      >
        <SlidersHorizontal size={15} />
        {advancedOpen ? t('agent_ai_advanced') : t('agent_ai_advanced_expand')}
      </button>
      {advancedOpen && (
        <div className="ai-advanced-row">
          <label>
            {t('agent_ai_timeout')}
            <input
              className="settings-input"
              disabled={busy}
              min={1}
              type="number"
              value={settings.request_timeout_secs}
              onChange={(e) => onSettingsChange({ request_timeout_secs: parseInt(e.target.value, 10) || 45 })}
            />
          </label>
          <label>
            {t('agent_ai_max_input')}
            <input
              className="settings-input"
              disabled={busy}
              min={2000}
              type="number"
              value={settings.max_input_chars}
              onChange={(e) => onSettingsChange({ max_input_chars: parseInt(e.target.value, 10) || 24000 })}
            />
          </label>
          <label>
            {t('agent_ai_temperature')}
            <input
              className="settings-input"
              disabled={busy}
              max={2}
              min={0}
              step={0.1}
              type="number"
              value={settings.temperature}
              onChange={(e) => onSettingsChange({ temperature: parseFloat(e.target.value) || 0 })}
            />
          </label>
        </div>
      )}

      {/* Action bar */}
      <div className="ai-actions-bar">
        <span className="ai-actions-notice">
          {usable ? <CheckCircle2 size={14} /> : <KeyRound size={14} />}
          {t('agent_ai_external_notice')}
        </span>
        <div className="ai-settings-actions">
          <button className="settings-btn-outline" disabled={busy} onClick={onClearKey} type="button">
            <RotateCcw size={14} />
            {t('agent_ai_clear_key')}
          </button>
          <button className="settings-btn-outline" disabled={busy} onClick={onTest} type="button">
            <TestTube2 size={14} />
            {t('agent_ai_test')}
          </button>
          <button className="settings-btn-primary" disabled={busy} onClick={onSave} type="button">
            <Save size={14} />
            {settings.enabled ? t('agent_ai_save_enable') : t('agent_ai_save')}
          </button>
        </div>
      </div>
    </section>
  );
};
