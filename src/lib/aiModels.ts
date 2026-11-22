import type { AiProviderSettings } from '../types/agent';
import type { TranslationKeys } from '../i18n';

export type AiProvider = AiProviderSettings['provider'];
export type AiModelGroup = 'openai' | 'anthropic' | 'china' | 'local';

export interface AiModelPreset {
  id: string;
  group: AiModelGroup;
  vendor: string;
  title: string;
  descriptionKey: TranslationKeys;
  badgeKey: TranslationKeys;
  provider: AiProvider;
  base_url: string;
  model: string;
  apiKeyHint: string;
}

export const aiModelGroupLabels: Record<AiModelGroup, TranslationKeys> = {
  openai: 'agent_ai_group_openai',
  anthropic: 'agent_ai_group_anthropic',
  china: 'agent_ai_group_china',
  local: 'agent_ai_group_local',
};

export const providerDefaults: Record<
  AiProvider,
  Pick<AiProviderSettings, 'base_url' | 'model'>
> = {
  openai_compatible: { base_url: 'https://api.openai.com/v1', model: 'gpt-6.2-sol' },
  anthropic_compatible: {
    base_url: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5-5',
  },
  ollama: { base_url: 'http://localhost:11434/v1', model: 'gpt-oss:20b' },
};

export const aiModelPresets: AiModelPreset[] = [
  {
    id: 'openai-gpt-6-2-astra',
    group: 'openai',
    vendor: 'OpenAI',
    title: 'GPT-6.2 Astra',
    descriptionKey: 'agent_ai_preset_openai_gpt55_desc',
    badgeKey: 'agent_ai_preset_flagship',
    provider: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-6.2-astra',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'openai-gpt-6-2-sol',
    group: 'openai',
    vendor: 'OpenAI',
    title: 'GPT-6.2 Sol',
    descriptionKey: 'agent_ai_preset_openai_gpt54mini_desc',
    badgeKey: 'agent_ai_preset_balanced',
    provider: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-6.2-sol',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'openai-gpt-6-luna',
    group: 'openai',
    vendor: 'OpenAI',
    title: 'GPT-6 Luna',
    descriptionKey: 'agent_ai_preset_anthropic_haiku_desc',
    badgeKey: 'agent_ai_preset_fast',
    provider: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-6-luna',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'anthropic-opus-5-5',
    group: 'anthropic',
    vendor: 'Anthropic',
    title: 'Claude Opus 5.5',
    descriptionKey: 'agent_ai_preset_anthropic_fable_desc',
    badgeKey: 'agent_ai_preset_flagship',
    provider: 'anthropic_compatible',
    base_url: 'https://api.anthropic.com/v1',
    model: 'claude-opus-5-5',
    apiKeyHint: 'sk-ant-...',
  },
  {
    id: 'anthropic-sonnet-5-5',
    group: 'anthropic',
    vendor: 'Anthropic',
    title: 'Claude Sonnet 5.5',
    descriptionKey: 'agent_ai_preset_anthropic_sonnet_desc',
    badgeKey: 'agent_ai_preset_balanced',
    provider: 'anthropic_compatible',
    base_url: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5-5',
    apiKeyHint: 'sk-ant-...',
  },
  {
    id: 'anthropic-haiku-5-5',
    group: 'anthropic',
    vendor: 'Anthropic',
    title: 'Claude Haiku 5.5',
    descriptionKey: 'agent_ai_preset_anthropic_haiku_desc',
    badgeKey: 'agent_ai_preset_fast',
    provider: 'anthropic_compatible',
    base_url: 'https://api.anthropic.com/v1',
    model: 'claude-haiku-5-5',
    apiKeyHint: 'sk-ant-...',
  },
  {
    id: 'deepseek-flash',
    group: 'china',
    vendor: 'DeepSeek',
    title: 'DeepSeek V4.1 Flash',
    descriptionKey: 'agent_ai_preset_deepseek_v4_desc',
    badgeKey: 'agent_ai_preset_china',
    provider: 'openai_compatible',
    base_url: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'qwen4-max',
    group: 'china',
    vendor: '阿里云百炼',
    title: 'Qwen4 Max',
    descriptionKey: 'agent_ai_preset_qwen_max_desc',
    badgeKey: 'agent_ai_preset_flagship',
    provider: 'openai_compatible',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen4-max',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'qwen3-5-flash',
    group: 'china',
    vendor: '阿里云百炼',
    title: 'Qwen3.5 Flash',
    descriptionKey: 'agent_ai_preset_qwen_plus_desc',
    badgeKey: 'agent_ai_preset_china',
    provider: 'openai_compatible',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.5-flash',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'glm-5-3',
    group: 'china',
    vendor: '智谱 GLM',
    title: 'GLM-5.3',
    descriptionKey: 'agent_ai_preset_glm45_desc',
    badgeKey: 'agent_ai_preset_china',
    provider: 'openai_compatible',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'kimi-k3-1-pro',
    group: 'china',
    vendor: 'Moonshot Kimi',
    title: 'Kimi K3.1 Pro',
    descriptionKey: 'agent_ai_preset_kimi_k26_desc',
    badgeKey: 'agent_ai_preset_china',
    provider: 'openai_compatible',
    base_url: 'https://api.moonshot.ai/v1',
    model: 'kimi-k3.1-pro',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'minimax-m3-1-flash',
    group: 'china',
    vendor: 'MiniMax',
    title: 'MiniMax M3.1 Flash',
    descriptionKey: 'agent_ai_preset_minimax_m3_desc',
    badgeKey: 'agent_ai_preset_china',
    provider: 'openai_compatible',
    base_url: 'https://api.minimax.io/v1',
    model: 'MiniMax-M3.1-Flash',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'doubao-seed-2-1-pro',
    group: 'china',
    vendor: '火山方舟',
    title: 'Doubao Seed 2.1 Pro',
    descriptionKey: 'agent_ai_preset_doubao_seed_desc',
    badgeKey: 'agent_ai_preset_china',
    provider: 'openai_compatible',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-1-pro-260915',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'ollama-gpt-oss-20b',
    group: 'local',
    vendor: 'Ollama',
    title: 'gpt-oss 20B',
    descriptionKey: 'agent_ai_preset_ollama_gptoss_desc',
    badgeKey: 'agent_ai_preset_local',
    provider: 'ollama',
    base_url: 'http://localhost:11434/v1',
    model: 'gpt-oss:20b',
    apiKeyHint: '',
  },
  {
    id: 'ollama-qwen3',
    group: 'local',
    vendor: 'Ollama',
    title: 'Qwen3 32B',
    descriptionKey: 'agent_ai_preset_ollama_qwen3_desc',
    badgeKey: 'agent_ai_preset_local',
    provider: 'ollama',
    base_url: 'http://localhost:11434/v1',
    model: 'qwen3:32b',
    apiKeyHint: '',
  },
  {
    id: 'ollama-qwen-coder',
    group: 'local',
    vendor: 'Ollama',
    title: 'Qwen2.5 Coder 7B',
    descriptionKey: 'agent_ai_preset_ollama_llama_desc',
    badgeKey: 'agent_ai_preset_local',
    provider: 'ollama',
    base_url: 'http://localhost:11434/v1',
    model: 'qwen2.5-coder:7b',
    apiKeyHint: '',
  },
];

export const compatibleProviderLabels: Record<AiProvider, string> = {
  openai_compatible: 'OpenAI Compatible',
  anthropic_compatible: 'Anthropic Compatible',
  ollama: 'Ollama',
};

export const findAiModelPreset = (
  settings: Pick<AiProviderSettings, 'provider' | 'base_url' | 'model'>,
) =>
  aiModelPresets.find(
    (preset) =>
      preset.provider === settings.provider &&
      preset.model === settings.model &&
      preset.base_url.replace(/\/$/, '') === settings.base_url.replace(/\/$/, ''),
  );

export const getAiModelDisplayName = (
  settings: Pick<AiProviderSettings, 'provider' | 'base_url' | 'model'>,
) =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  findAiModelPreset(settings)?.title ||
  settings.model ||
  compatibleProviderLabels[settings.provider];

export const isAiProviderUsable = (settings: AiProviderSettings | null | undefined) => {
  if (!settings?.enabled) return false;
  if (!settings.base_url.trim() || !settings.model.trim()) return false;
  return settings.provider === 'ollama' || settings.api_key_configured;
};
