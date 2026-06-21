import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useAgentPolicyStore } from '../../stores/agentPolicyStore';
import {
  aiModelPresets,
  findAiModelPreset,
  isAiProviderUsable,
  providerDefaults,
  type AiModelGroup,
} from '../../lib/aiModels';
import type { AgentPolicySettings, AiProviderSettings } from '../../types/agent';
import { AiModelPicker } from './AiModelPicker';
import { AiConnectionConfig } from './AiConnectionConfig';
import { AgentPolicySection } from './AgentPolicySection';

type ModelTab = AiModelGroup | 'all';

const defaults: AiProviderSettings = {
  enabled: false,
  provider: 'openai_compatible',
  base_url: 'https://api.openai.com/v1',
  model: 'gpt-5.5',
  api_key_configured: false,
  temperature: 0.2,
  max_input_chars: 24000,
  request_timeout_secs: 45,
};

const emitAiSettingsChanged = () => window.dispatchEvent(new CustomEvent('gwshell-ai-settings-changed'));

export const AiSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AiProviderSettings>(defaults);
  const policy = useAgentPolicyStore((s) => s.policy);
  const setPolicy = useAgentPolicyStore((s) => s.setPolicy);
  const loadPolicy = useAgentPolicyStore((s) => s.load);
  const savePolicy = useAgentPolicyStore((s) => s.save);
  const [apiKey, setApiKey] = useState('');
  const [aiMessage, setAiMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [policyMessage, setPolicyMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeModelTab, setActiveModelTab] = useState<ModelTab>('china');

  useEffect(() => {
    invoke<AiProviderSettings>('load_ai_provider_settings')
      .then((loaded) => setSettings({ ...defaults, ...loaded }))
      .catch((err) => setAiMessage({ kind: 'err', text: String(err) }));
    loadPolicy().catch((err) => setPolicyMessage({ kind: 'err', text: String(err) }));
  }, [loadPolicy]);

  const selectedPreset = useMemo(() => findAiModelPreset(settings), [settings]);
  const usable =
    isAiProviderUsable(settings) ||
    (settings.enabled && Boolean(settings.base_url.trim()) && Boolean(settings.model.trim()) && Boolean(apiKey.trim()));
  const status = useMemo(() => {
    if (!settings.enabled) return { kind: 'off' as const, label: t('agent_ai_status_disabled') };
    if (!settings.model.trim() || !settings.base_url.trim()) return { kind: 'warn' as const, label: t('agent_ai_status_incomplete') };
    if (settings.provider !== 'ollama' && !settings.api_key_configured && !apiKey.trim()) {
      return { kind: 'warn' as const, label: t('agent_ai_status_key_missing') };
    }
    return { kind: 'ok' as const, label: t('agent_ai_status_ready') };
  }, [apiKey, settings, t]);
  const keyPlaceholder = settings.provider === 'ollama'
    ? ''
    : (selectedPreset?.apiKeyHint || (settings.provider === 'anthropic_compatible' ? 'sk-ant-...' : 'sk-...'));

  const onSettingsChange = (partial: Partial<AiProviderSettings>) => {
    setSettings((s) => ({ ...s, ...partial }));
    setAiMessage(null);
  };
  const onPolicyChange = (partial: Partial<AgentPolicySettings>) => setPolicy({ ...policy, ...partial });

  const normalizedSettings = (): AiProviderSettings => ({
    ...settings,
    base_url: settings.base_url.trim(),
    model: settings.model.trim(),
    request_timeout_secs: Math.max(1, settings.request_timeout_secs || defaults.request_timeout_secs),
    max_input_chars: Math.max(2000, settings.max_input_chars || defaults.max_input_chars),
    temperature: Number.isFinite(settings.temperature) ? settings.temperature : defaults.temperature,
  });

  const reloadSettings = async () => {
    const loaded = await invoke<AiProviderSettings>('load_ai_provider_settings');
    setSettings({ ...defaults, ...loaded });
  };

  const persistAiSettings = async () => {
    const trimmedKey = apiKey.trim();
    if (trimmedKey) await invoke('set_ai_provider_api_key', { apiKey: trimmedKey });
    await invoke('save_ai_provider_settings', { settings: normalizedSettings() });
    await reloadSettings();
    if (trimmedKey) setApiKey('');
    emitAiSettingsChanged();
  };

  const save = async () => {
    setAiMessage({ kind: 'ok', text: t('agent_ai_model_selected_save_hint') });
    try {
      setBusy(true);
      await persistAiSettings();
      setAiMessage({ kind: 'ok', text: t('agent_ai_saved') });
    } catch (err) {
      setAiMessage({ kind: 'err', text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const testProvider = async () => {
    setAiMessage({ kind: 'ok', text: t('agent_ai_model_selected_save_hint') });
    try {
      setBusy(true);
      const result = await invoke<string>('test_ai_provider_with_settings', {
        settings: normalizedSettings(),
        apiKey: apiKey.trim() || null,
      });
      setAiMessage({ kind: 'ok', text: result });
    } catch (err) {
      setAiMessage({ kind: 'err', text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const savePolicySettings = async () => {
    setPolicyMessage(null);
    try {
      setBusy(true);
      await savePolicy(policy);
      setPolicyMessage({ kind: 'ok', text: t('agent_policy_saved') });
    } catch (err) {
      setPolicyMessage({ kind: 'err', text: String(err) });
    } finally {
      setBusy(false);
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
    setSettings((s) => ({ ...s, enabled: true, provider: preset.provider, base_url: preset.base_url, model: preset.model }));
    setAiMessage(null);
  };

  const selectCompatibleProvider = (provider: AiProviderSettings['provider']) => {
    setSettings((s) => ({ ...s, enabled: true, provider, ...providerDefaults[provider] }));
    setAiMessage(null);
  };

  return (
    <>
      <div className="settings-section-title">{t('agent_ai_title')}</div>
      <div className="ai-settings-shell ai-settings-dual">
        <AiModelPicker
          activePresetId={selectedPreset?.id}
          activeTab={activeModelTab}
          busy={busy}
          onApply={applyModelPreset}
          onTabChange={setActiveModelTab}
        />
        <AiConnectionConfig
          settings={settings}
          apiKey={apiKey}
          status={status}
          keyPlaceholder={keyPlaceholder}
          usable={usable}
          busy={busy}
          message={aiMessage}
          onSettingsChange={onSettingsChange}
          onApiKeyChange={setApiKey}
          onSelectProvider={selectCompatibleProvider}
          onClearKey={clearKey}
          onTest={testProvider}
          onSave={save}
        />
      </div>
      <AgentPolicySection
        policy={policy}
        busy={busy}
        onChange={onPolicyChange}
        onSave={savePolicySettings}
        message={policyMessage}
      />
    </>
  );
};
