import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { AiProviderSettings } from '../../types/agent';

const defaults: AiProviderSettings = {
  enabled: false,
  provider: 'openai_compatible',
  base_url: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
  api_key_configured: false,
  temperature: 0.2,
  max_input_chars: 24000,
  request_timeout_secs: 45,
};

export const AiSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AiProviderSettings>(defaults);
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invoke<AiProviderSettings>('load_ai_provider_settings')
      .then((loaded) => setSettings({ ...defaults, ...loaded, provider: 'openai_compatible' }))
      .catch((err) => setMessage({ kind: 'err', text: String(err) }));
  }, []);

  const save = async () => {
    setMessage(null);
    try {
      setBusy(true);
      await invoke('save_ai_provider_settings', { settings });
      if (apiKey.trim()) {
        await invoke('set_ai_provider_api_key', { apiKey: apiKey.trim() });
        setApiKey('');
        setSettings((s) => ({ ...s, api_key_configured: true }));
      }
      setMessage({ kind: 'ok', text: t('agent_ai_saved') });
    } catch (err) {
      setMessage({ kind: 'err', text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    setMessage(null);
    try {
      setBusy(true);
      await invoke('clear_ai_provider_api_key');
      setApiKey('');
      setSettings((s) => ({ ...s, api_key_configured: false }));
      setMessage({ kind: 'ok', text: t('agent_ai_key_cleared') });
    } catch (err) {
      setMessage({ kind: 'err', text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="settings-section-title">{t('agent_ai_title')}</div>
      <div className="settings-col" style={{ maxWidth: 760 }}>
        <label className="settings-row">
          <span className="settings-row-left">
            <span className="settings-label">{t('agent_ai_enabled')}</span>
          </span>
          <span className="settings-row-right">
            <button
              className={`settings-toggle ${settings.enabled ? 'on' : ''}`}
              disabled={busy}
              onClick={() => setSettings((s) => ({ ...s, enabled: !s.enabled }))}
              type="button"
            >
              <span className="settings-toggle-knob" />
            </button>
          </span>
        </label>
        <div className="settings-row">
          <span className="settings-row-left">
            <span className="settings-label">{t('agent_ai_base_url')}</span>
          </span>
          <span className="settings-row-right">
            <input
              className="settings-input"
              disabled={busy}
              style={{ width: 320 }}
              value={settings.base_url}
              onChange={(e) => setSettings((s) => ({ ...s, base_url: e.target.value }))}
            />
          </span>
        </div>
        <div className="settings-row">
          <span className="settings-row-left">
            <span className="settings-label">{t('agent_ai_model')}</span>
          </span>
          <span className="settings-row-right">
            <input
              className="settings-input"
              disabled={busy}
              style={{ width: 220 }}
              value={settings.model}
              onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
            />
          </span>
        </div>
        <div className="settings-row">
          <span className="settings-row-left">
            <span className="settings-label">{t('agent_ai_api_key')}</span>
            <span className="settings-desc">
              {settings.api_key_configured ? t('agent_ai_key_configured') : t('agent_ai_key_missing')}
            </span>
          </span>
          <span className="settings-row-right">
            <input
              className="settings-input"
              disabled={busy}
              type="password"
              style={{ width: 260 }}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </span>
        </div>
        <div className="settings-row">
          <span className="settings-row-left">
            <span className="settings-label">{t('agent_ai_timeout')}</span>
          </span>
          <span className="settings-row-right">
            <input
              className="settings-input"
              disabled={busy}
              min={1}
              style={{ width: 90 }}
              type="number"
              value={settings.request_timeout_secs}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  request_timeout_secs: parseInt(e.target.value, 10) || 45,
                }))
              }
            />
          </span>
        </div>
        <div className="settings-row">
          <span className="settings-row-left">
            <span className="settings-desc">{t('agent_ai_external_notice')}</span>
          </span>
          <span className="settings-row-right">
            <button className="settings-btn-outline" disabled={busy} onClick={clearKey} type="button">
              {t('agent_ai_clear_key')}
            </button>
            <button className="settings-btn-primary" disabled={busy} style={{ marginLeft: 8 }} onClick={save} type="button">
              {t('settings_apply')}
            </button>
          </span>
        </div>
        {message && (
          <p className="settings-desc" style={{ color: message.kind === 'err' ? 'var(--danger)' : 'var(--success)' }}>
            {message.text}
          </p>
        )}
      </div>
    </>
  );
};
