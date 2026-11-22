import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import {
  aiModelPresets,
  findAiModelPreset,
  isAiProviderUsable,
  providerDefaults,
  type AiModelGroup,
} from '../../lib/aiModels';
import type { AiProviderSettings } from '../../types/agent';
import { AiModelPicker } from './AiModelPicker';
import { AiConnectionConfig } from './AiConnectionConfig';

type ModelTab = AiModelGroup | 'all';

const defaults: AiProviderSettings = {
  enabled: false,
  provider: 'openai_compatible',
  base_url: 'https://api.openai.com/v1',
  model: 'gpt-6.2-sol',
  api_key_configured: false,
  temperature: 0.2,
  max_input_chars: 24000,
  request_timeout_secs: 120,
};

const emitAiSettingsChanged = () =>
  window.dispatchEvent(new CustomEvent('gwshell-ai-settings-changed'));

export const AiSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AiProviderSettings>(defaults);
  const [savedSettings, setSavedSettings] = useState<AiProviderSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [aiMessage, setAiMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [activeModelTab, setActiveModelTab] = useState<ModelTab>('all');
  const [explicitlyDisabled, setExplicitlyDisabled] = useState(false);

  useEffect(() => {
    invoke<AiProviderSettings>('load_ai_provider_settings')
      .then((loaded) => {
        const merged = { ...defaults, ...loaded };
        setSettings(merged);
        setSavedSettings(merged);
      })
      .catch((err) => setAiMessage({ kind: 'err', text: String(err) }));
  }, []);

  const isDirty = useMemo(() => {
    if (apiKey.trim().length > 0) return true;
    if (!savedSettings) return false;
    return (
      settings.enabled !== savedSettings.enabled ||
      settings.provider !== savedSettings.provider ||
      settings.base_url.trim() !== savedSettings.base_url.trim() ||
      settings.model.trim() !== savedSettings.model.trim() ||
      settings.temperature !== savedSettings.temperature ||
      settings.max_input_chars !== savedSettings.max_input_chars ||
      settings.request_timeout_secs !== savedSettings.request_timeout_secs
    );
  }, [apiKey, savedSettings, settings]);

  const selectedPreset = useMemo(() => findAiModelPreset(settings), [settings]);
  const hasUsableCredentials =
    settings.provider === 'ollama' || settings.api_key_configured || Boolean(apiKey.trim());
  const usable =
    isAiProviderUsable(settings) ||
    (settings.enabled &&
      Boolean(settings.base_url.trim()) &&
      Boolean(settings.model.trim()) &&
      hasUsableCredentials);

  const status = useMemo(() => {
    if (!settings.enabled) return { kind: 'off' as const, label: t('agent_ai_status_disabled') }; // eslint-disable-line no-restricted-syntax -- literal type narrowing for discriminated union
    if (!settings.model.trim() || !settings.base_url.trim())
      return { kind: 'warn' as const, label: t('agent_ai_status_incomplete') }; // eslint-disable-line no-restricted-syntax -- literal type narrowing for discriminated union
    if (!hasUsableCredentials) {
      return { kind: 'warn' as const, label: t('agent_ai_status_key_missing') }; // eslint-disable-line no-restricted-syntax -- literal type narrowing for discriminated union
    }
    return { kind: 'ok' as const, label: t('agent_ai_status_ready') }; // eslint-disable-line no-restricted-syntax -- literal type narrowing for discriminated union
  }, [hasUsableCredentials, settings, t]);

  const keyPlaceholder =
    settings.provider === 'ollama'
      ? ''
      : // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        selectedPreset?.apiKeyHint ||
        (settings.provider === 'anthropic_compatible' ? 'sk-ant-...' : 'sk-...');

  const onSettingsChange = (partial: Partial<AiProviderSettings>) => {
    if (partial.enabled === false) {
      setExplicitlyDisabled(true);
    } else if (partial.enabled === true) {
      setExplicitlyDisabled(false);
    }
    if (partial.base_url !== undefined || partial.provider !== undefined) {
      setFetchedModels([]);
    }
    setSettings((s) => ({ ...s, ...partial }));
    setAiMessage(null);
  };

  const normalizedSettings = (autoEnable = false): AiProviderSettings => {
    const baseUrl = settings.base_url.trim();
    const model = settings.model.trim();
    const shouldAutoEnable =
      autoEnable &&
      !explicitlyDisabled &&
      Boolean(baseUrl) &&
      Boolean(model) &&
      hasUsableCredentials;
    return {
      ...settings,
      enabled: settings.enabled || shouldAutoEnable,
      base_url: baseUrl,
      model,
      request_timeout_secs: Math.max(
        defaults.request_timeout_secs,
        settings.request_timeout_secs || defaults.request_timeout_secs,
      ),
      max_input_chars: Math.max(2000, settings.max_input_chars || defaults.max_input_chars),
      temperature: Number.isFinite(settings.temperature)
        ? settings.temperature
        : defaults.temperature,
    };
  };

  const reloadSettings = async () => {
    const loaded = await invoke<AiProviderSettings>('load_ai_provider_settings');
    const merged = { ...defaults, ...loaded };
    setSettings(merged);
    setSavedSettings(merged);
  };

  const save = async () => {
    setAiMessage(null);
    try {
      setBusy(true);
      const trimmedKey = apiKey.trim();
      if (trimmedKey) {
        await invoke('set_ai_provider_api_key', { apiKey: trimmedKey });
      }
      await invoke('save_ai_provider_settings', { settings: normalizedSettings(true) });
      await reloadSettings();
      if (trimmedKey) setApiKey('');
      setExplicitlyDisabled(false);
      emitAiSettingsChanged();
      setAiMessage({ kind: 'ok', text: t('agent_ai_saved') });
    } catch (err) {
      setAiMessage({ kind: 'err', text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const testProvider = async () => {
    setAiMessage(null);
    try {
      setTesting(true);
      const result = await invoke<string>('test_ai_provider_with_settings', {
        settings: normalizedSettings(false),
        apiKey: apiKey.trim() || null,
      });
      setAiMessage({ kind: 'ok', text: result });
    } catch (err) {
      setAiMessage({ kind: 'err', text: String(err) });
    } finally {
      setTesting(false);
    }
  };

  const fetchModels = async () => {
    setAiMessage(null);
    try {
      setFetchingModels(true);
      const list = await invoke<string[]>('list_ai_models', {
        settings: normalizedSettings(false),
        apiKey: apiKey.trim() || null,
      });
      setFetchedModels(list);
      if (list.length > 0 && !list.includes(settings.model.trim())) {
        setSettings((s) => ({ ...s, model: list[0] }));
      }
      setAiMessage({ kind: 'ok', text: t('ai_models_fetched', { count: list.length }) });
    } catch (err) {
      setFetchedModels([]);
      setAiMessage({ kind: 'err', text: String(err) });
    } finally {
      setFetchingModels(false);
    }
  };

  const clearKey = async () => {
    setAiMessage(null);
    try {
      setBusy(true);
      await invoke('clear_ai_provider_api_key');
      setApiKey('');
      await reloadSettings();
      emitAiSettingsChanged();
      setAiMessage({ kind: 'ok', text: t('agent_ai_key_cleared') });
    } catch (err) {
      setAiMessage({ kind: 'err', text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const applyModelPreset = (presetId: string) => {
    const preset = aiModelPresets.find((item) => item.id === presetId);
    if (!preset) return;
    setExplicitlyDisabled(false);
    setFetchedModels([]);
    setSettings((s) => ({
      ...s,
      enabled: true,
      provider: preset.provider,
      base_url: preset.base_url,
      model: preset.model,
    }));
    setAiMessage(null);
  };

  const selectCompatibleProvider = (provider: AiProviderSettings['provider']) => {
    setExplicitlyDisabled(false);
    setFetchedModels([]);
    setSettings((s) => ({ ...s, enabled: true, provider, ...providerDefaults[provider] }));
    setAiMessage(null);
  };

  return (
    <div className="ai-settings-page">
      <div className="settings-section-title">{t('agent_ai_title')}</div>
      <AiConnectionConfig
        settings={settings}
        apiKey={apiKey}
        status={status}
        keyPlaceholder={keyPlaceholder}
        usable={usable}
        isDirty={isDirty}
        busy={busy}
        testing={testing}
        fetchingModels={fetchingModels}
        fetchedModels={fetchedModels}
        message={aiMessage}
        onSettingsChange={onSettingsChange}
        onApiKeyChange={setApiKey}
        onSelectProvider={selectCompatibleProvider}
        onFetchModels={() => {
          void fetchModels();
        }}
        onClearKey={() => {
          void clearKey();
        }}
        onTest={() => {
          void testProvider();
        }}
        onSave={() => {
          void save();
        }}
      />
      <AiModelPicker
        activePresetId={selectedPreset?.id}
        activeTab={activeModelTab}
        busy={busy}
        onApply={applyModelPreset}
        onTabChange={setActiveModelTab}
      />
    </div>
  );
};
