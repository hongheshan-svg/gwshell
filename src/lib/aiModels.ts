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

export const providerDefaults: Record<AiProvider, Pick<AiProviderSettings, 'base_url' | 'model'>> = {
  openai_compatible: { base_url: 'https://api.openai.com/v1', model: 'gpt-5.5' },
  anthropic_compatible: { base_url: 'https://api.anthropic.com/v1', model: 'claude-fable-5' },
  ollama: { base_url: 'http://localhost:11434/v1', model: 'gpt-oss:20b' },
};

export const aiModelPresets: AiModelPreset[] = [
  {
    id: 'openai-gpt-5-5',
    group: 'openai',
    vendor: 'OpenAI',
    title: 'GPT-5.5',
    descriptionKey: 'agent_ai_preset_openai_gpt55_desc',
    badgeKey: 'agent_ai_preset_flagship',
    provider: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'openai-gpt-5-4-mini',
    group: 'openai',
    vendor: 'OpenAI',
    title: 'GPT-5.4 mini',
    descriptionKey: 'agent_ai_preset_openai_gpt54mini_desc',
    badgeKey: 'agent_ai_preset_balanced',
    provider: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'anthropic-fable-5',
    group: 'anthropic',
    vendor: 'Anthropic',
    title: 'Claude Fable 5',
    descriptionKey: 'agent_ai_preset_anthropic_fable_desc',
    badgeKey: 'agent_ai_preset_flagship',
    provider: 'anthropic_compatible',
    base_url: 'https://api.anthropic.com/v1',
    model: 'claude-fable-5',
    apiKeyHint: 'sk-ant-...',
  },
  {
    id: 'anthropic-sonnet-4-6',
    group: 'anthropic',
    vendor: 'Anthropic',
    title: 'Claude Sonnet 4.6',
    descriptionKey: 'agent_ai_preset_anthropic_sonnet_desc',
    badgeKey: 'agent_ai_preset_balanced',
    provider: 'anthropic_compatible',
    base_url: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-6',
    apiKeyHint: 'sk-ant-...',
  },
  {
    id: 'anthropic-haiku-4-5',
    group: 'anthropic',
    vendor: 'Anthropic',
    title: 'Claude Haiku 4.5',
    descriptionKey: 'agent_ai_preset_anthropic_haiku_desc',
    badgeKey: 'agent_ai_preset_fast',
    provider: 'anthropic_compatible',
    base_url: 'https://api.anthropic.com/v1',
    model: 'claude-haiku-4-5',
    apiKeyHint: 'sk-ant-...',
  },
  {
    id: 'deepseek-v4-flash',
    group: 'china',
    vendor: 'DeepSeek',
    title: 'DeepSeek V4 Flash',
    descriptionKey: 'agent_ai_preset_deepseek_v4_desc',
    badgeKey: 'agent_ai_preset_china',
    provider: 'openai_compatible',
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'qwen-plus',
    group: 'china',
    vendor: '阿里云百炼',
    title: 'Qwen Plus',
    descriptionKey: 'agent_ai_preset_qwen_plus_desc',
    badgeKey: 'agent_ai_preset_china',
    provider: 'openai_compatible',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'qwen-max',
    group: 'china',
    vendor: '阿里云百炼',
    title: 'Qwen Max',
    descriptionKey: 'agent_ai_preset_qwen_max_desc',
    badgeKey: 'agent_ai_preset_china',
    provider: 'openai_compatible',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'glm-4-5',
    group: 'china',
    vendor: '智谱 GLM',
    title: 'GLM-4.5',
    descriptionKey: 'agent_ai_preset_glm45_desc',
    badgeKey: 'agent_ai_preset_china',
    provider: 'openai_compatible',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.5',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'kimi-k2-6',
    group: 'china',
    vendor: 'Moonshot Kimi',
    title: 'Kimi K2.6',
    descriptionKey: 'agent_ai_preset_kimi_k26_desc',
    badgeKey: 'agent_ai_preset_china',
    provider: 'openai_compatible',
    base_url: 'https://api.moonshot.ai/v1',
    model: 'kimi-k2.6',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'minimax-m3',
    group: 'china',
    vendor: 'MiniMax',
    title: 'MiniMax-M3',
    descriptionKey: 'agent_ai_preset_minimax_m3_desc',
    badgeKey: 'agent_ai_preset_china',
    provider: 'openai_compatible',
    base_url: 'https://api.minimax.io/v1',
    model: 'MiniMax-M3',
    apiKeyHint: 'sk-...',
  },
  {
    id: 'doubao-seed',
    group: 'china',
    vendor: '火山方舟',
    title: 'Doubao Seed',
    descriptionKey: 'agent_ai_preset_doubao_seed_desc',
    badgeKey: 'agent_ai_preset_china',
    provider: 'openai_compatible',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1-8-251228',
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
    title: 'Qwen3 local',
    descriptionKey: 'agent_ai_preset_ollama_qwen3_desc',
    badgeKey: 'agent_ai_preset_local',
    provider: 'ollama',
    base_url: 'http://localhost:11434/v1',
    model: 'qwen3:32b',
    apiKeyHint: '',
  },
  {
    id: 'ollama-llama3-1',
    group: 'local',
    vendor: 'Ollama',
    title: 'Llama 3.1 local',
    descriptionKey: 'agent_ai_preset_ollama_llama_desc',
    badgeKey: 'agent_ai_preset_local',
    provider: 'ollama',
    base_url: 'http://localhost:11434/v1',
    model: 'llama3.1',
    apiKeyHint: '',
  },
];

export const compatibleProviderLabels: Record<AiProvider, string> = {
  openai_compatible: 'OpenAI Compatible',
  anthropic_compatible: 'Anthropic Compatible',
  ollama: 'Ollama',
};

export const findAiModelPreset = (settings: Pick<AiProviderSettings, 'provider' | 'base_url' | 'model'>) =>
  aiModelPresets.find(
    (preset) =>
      preset.provider === settings.provider &&
      preset.model === settings.model &&
      preset.base_url.replace(/\/$/, '') === settings.base_url.replace(/\/$/, ''),
  );

export const getAiModelDisplayName = (settings: Pick<AiProviderSettings, 'provider' | 'base_url' | 'model'>) =>
  findAiModelPreset(settings)?.title || settings.model || compatibleProviderLabels[settings.provider];

export const isAiProviderUsable = (settings: AiProviderSettings | null | undefined) => {
  if (!settings?.enabled) return false;
  if (!settings.base_url.trim() || !settings.model.trim()) return false;
  return settings.provider === 'ollama' || settings.api_key_configured;
};
