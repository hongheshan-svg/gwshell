/**
 * Provider presets data — faithfully replicating CC Switch preset configs.
 * Each app has its own preset array with settingsConfig that matches
 * what the Rust backend writes directly to CLI tool config files.
 */

export type PresetCategory = 'official' | 'cn_official' | 'cloud_provider' | 'aggregator' | 'third_party' | 'custom';

export interface AppPreset {
  name: string;
  websiteUrl?: string;
  apiKeyUrl?: string;
  settingsConfig: Record<string, any>;
  category: PresetCategory;
  icon?: string;
  iconColor?: string;
  isPartner?: boolean;
  isOfficial?: boolean;
  hidden?: boolean;
}

/* =========================================================================
 * CLAUDE PRESETS — settingsConfig.env → ~/.claude/settings.json
 * ========================================================================= */
export const CLAUDE_PRESETS: AppPreset[] = [
  { name: 'Claude Official', websiteUrl: 'https://www.anthropic.com/claude-code', settingsConfig: { env: {} }, isOfficial: true, category: 'official', icon: 'anthropic', iconColor: '#D97757' },
  // ---- cn_official ----
  { name: 'DeepSeek', websiteUrl: 'https://platform.deepseek.com', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'DeepSeek-V3.2', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'DeepSeek-V3.2', ANTHROPIC_DEFAULT_SONNET_MODEL: 'DeepSeek-V3.2', ANTHROPIC_DEFAULT_OPUS_MODEL: 'DeepSeek-V3.2' } }, category: 'cn_official', icon: 'deepseek', iconColor: '#1E88E5' },
  { name: 'Zhipu GLM', websiteUrl: 'https://open.bigmodel.cn', apiKeyUrl: 'https://www.bigmodel.cn/claude-code?ic=RRVJPB5SII', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'glm-5', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5', ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5' } }, category: 'cn_official', icon: 'zhipu', iconColor: '#0F62FE' },
  { name: 'Zhipu GLM en', websiteUrl: 'https://z.ai', apiKeyUrl: 'https://z.ai/subscribe?ic=8JVLJQFSKB', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'glm-5', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5', ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5' } }, category: 'cn_official', icon: 'zhipu', iconColor: '#0F62FE' },
  { name: 'Bailian', websiteUrl: 'https://bailian.console.aliyun.com', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'cn_official', icon: 'bailian', iconColor: '#624AFF' },
  { name: 'Bailian For Coding', websiteUrl: 'https://bailian.console.aliyun.com', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://coding.dashscope.aliyuncs.com/apps/anthropic', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'cn_official', icon: 'bailian', iconColor: '#624AFF' },
  { name: 'Kimi', websiteUrl: 'https://platform.moonshot.cn/console', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'kimi-k2.5', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k2.5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k2.5', ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k2.5' } }, category: 'cn_official', icon: 'kimi', iconColor: '#6366F1' },
  { name: 'Kimi For Coding', websiteUrl: 'https://www.kimi.com/coding/docs/', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding/', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'cn_official', icon: 'kimi', iconColor: '#6366F1' },
  { name: 'StepFun', websiteUrl: 'https://platform.stepfun.ai', apiKeyUrl: 'https://platform.stepfun.ai/interface-key', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.stepfun.ai/v1', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'step-3.5-flash', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'step-3.5-flash', ANTHROPIC_DEFAULT_SONNET_MODEL: 'step-3.5-flash', ANTHROPIC_DEFAULT_OPUS_MODEL: 'step-3.5-flash' } }, category: 'cn_official', icon: 'stepfun', iconColor: '#005AFF' },
  { name: 'KAT-Coder', websiteUrl: 'https://console.streamlake.ai', apiKeyUrl: 'https://console.streamlake.ai/console/api-key', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://vanchin.streamlake.ai/api/gateway/v1/endpoints/${ENDPOINT_ID}/claude-code-proxy', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'KAT-Coder-Pro V1', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'KAT-Coder-Air V1', ANTHROPIC_DEFAULT_SONNET_MODEL: 'KAT-Coder-Pro V1', ANTHROPIC_DEFAULT_OPUS_MODEL: 'KAT-Coder-Pro V1' } }, category: 'cn_official', icon: 'catcoder' },
  { name: 'Longcat', websiteUrl: 'https://longcat.chat/platform', apiKeyUrl: 'https://longcat.chat/platform/api_keys', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.longcat.chat/anthropic', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'LongCat-Flash-Chat', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'LongCat-Flash-Chat', ANTHROPIC_DEFAULT_SONNET_MODEL: 'LongCat-Flash-Chat', ANTHROPIC_DEFAULT_OPUS_MODEL: 'LongCat-Flash-Chat', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '6000', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1 } }, category: 'cn_official', icon: 'longcat', iconColor: '#29E154' },
  { name: 'MiniMax', websiteUrl: 'https://platform.minimaxi.com', apiKeyUrl: 'https://platform.minimaxi.com/subscribe/coding-plan', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic', ANTHROPIC_AUTH_TOKEN: '', API_TIMEOUT_MS: '3000000', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1, ANTHROPIC_MODEL: 'MiniMax-M2.7', ANTHROPIC_DEFAULT_SONNET_MODEL: 'MiniMax-M2.7', ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMax-M2.7', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMax-M2.7' } }, category: 'cn_official', isPartner: true, icon: 'minimax', iconColor: '#FF6B6B' },
  { name: 'MiniMax en', websiteUrl: 'https://platform.minimax.io', apiKeyUrl: 'https://platform.minimax.io/subscribe/coding-plan', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic', ANTHROPIC_AUTH_TOKEN: '', API_TIMEOUT_MS: '3000000', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1, ANTHROPIC_MODEL: 'MiniMax-M2.7', ANTHROPIC_DEFAULT_SONNET_MODEL: 'MiniMax-M2.7', ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMax-M2.7', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMax-M2.7' } }, category: 'cn_official', isPartner: true, icon: 'minimax', iconColor: '#FF6B6B' },
  { name: 'DouBaoSeed', websiteUrl: 'https://www.volcengine.com/product/doubao', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://ark.cn-beijing.volces.com/api/coding', ANTHROPIC_AUTH_TOKEN: '', API_TIMEOUT_MS: '3000000', ANTHROPIC_MODEL: 'doubao-seed-2-0-code-preview-latest', ANTHROPIC_DEFAULT_SONNET_MODEL: 'doubao-seed-2-0-code-preview-latest', ANTHROPIC_DEFAULT_OPUS_MODEL: 'doubao-seed-2-0-code-preview-latest', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'doubao-seed-2-0-code-preview-latest' } }, category: 'cn_official', icon: 'doubao', iconColor: '#3370FF' },
  { name: 'BaiLing', websiteUrl: 'https://alipaytbox.yuque.com/sxs0ba/ling/get_started', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.tbox.cn/api/anthropic', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'Ling-2.5-1T', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'Ling-2.5-1T', ANTHROPIC_DEFAULT_SONNET_MODEL: 'Ling-2.5-1T', ANTHROPIC_DEFAULT_OPUS_MODEL: 'Ling-2.5-1T' } }, category: 'cn_official' },
  { name: 'Xiaomi MiMo', websiteUrl: 'https://platform.xiaomimimo.com', apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.xiaomimimo.com/anthropic', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'mimo-v2-pro', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'mimo-v2-pro', ANTHROPIC_DEFAULT_SONNET_MODEL: 'mimo-v2-pro', ANTHROPIC_DEFAULT_OPUS_MODEL: 'mimo-v2-pro' } }, category: 'cn_official', icon: 'xiaomimimo' },
  // ---- cloud_provider ----
  { name: 'AWS Bedrock (AKSK)', websiteUrl: 'https://aws.amazon.com/bedrock/', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://bedrock-runtime.us-west-2.amazonaws.com', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', AWS_REGION: 'us-west-2', ANTHROPIC_MODEL: 'global.anthropic.claude-opus-4-6-v1', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', ANTHROPIC_DEFAULT_SONNET_MODEL: 'global.anthropic.claude-sonnet-4-6', ANTHROPIC_DEFAULT_OPUS_MODEL: 'global.anthropic.claude-opus-4-6-v1', CLAUDE_CODE_USE_BEDROCK: '1' } }, category: 'cloud_provider', icon: 'aws', iconColor: '#FF9900' },
  { name: 'AWS Bedrock (API Key)', websiteUrl: 'https://aws.amazon.com/bedrock/', settingsConfig: { apiKey: '', env: { ANTHROPIC_BASE_URL: 'https://bedrock-runtime.us-west-2.amazonaws.com', AWS_REGION: 'us-west-2', ANTHROPIC_MODEL: 'global.anthropic.claude-opus-4-6-v1', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', ANTHROPIC_DEFAULT_SONNET_MODEL: 'global.anthropic.claude-sonnet-4-6', ANTHROPIC_DEFAULT_OPUS_MODEL: 'global.anthropic.claude-opus-4-6-v1', CLAUDE_CODE_USE_BEDROCK: '1' } }, category: 'cloud_provider', icon: 'aws', iconColor: '#FF9900' },
  // ---- aggregator ----
  { name: 'ModelScope', websiteUrl: 'https://modelscope.cn', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api-inference.modelscope.cn', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'ZhipuAI/GLM-5', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'ZhipuAI/GLM-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'ZhipuAI/GLM-5', ANTHROPIC_DEFAULT_OPUS_MODEL: 'ZhipuAI/GLM-5' } }, category: 'aggregator', icon: 'modelscope', iconColor: '#624AFF' },
  { name: 'AiHubMix', websiteUrl: 'https://aihubmix.com', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://aihubmix.com', ANTHROPIC_API_KEY: '' } }, category: 'aggregator', icon: 'aihubmix', iconColor: '#006FFB' },
  { name: 'SiliconFlow', websiteUrl: 'https://siliconflow.cn', apiKeyUrl: 'https://cloud.siliconflow.cn/i/drGuwc9k', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.siliconflow.cn', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'Pro/MiniMaxAI/MiniMax-M2.7', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'Pro/MiniMaxAI/MiniMax-M2.7', ANTHROPIC_DEFAULT_SONNET_MODEL: 'Pro/MiniMaxAI/MiniMax-M2.7', ANTHROPIC_DEFAULT_OPUS_MODEL: 'Pro/MiniMaxAI/MiniMax-M2.7' } }, category: 'aggregator', isPartner: true, icon: 'siliconflow', iconColor: '#6E29F6' },
  { name: 'SiliconFlow en', websiteUrl: 'https://siliconflow.com', apiKeyUrl: 'https://cloud.siliconflow.cn/i/drGuwc9k', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.siliconflow.com', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'MiniMaxAI/MiniMax-M2.7', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMaxAI/MiniMax-M2.7', ANTHROPIC_DEFAULT_SONNET_MODEL: 'MiniMaxAI/MiniMax-M2.7', ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMaxAI/MiniMax-M2.7' } }, category: 'aggregator', isPartner: true, icon: 'siliconflow', iconColor: '#000000' },
  { name: 'DMXAPI', websiteUrl: 'https://www.dmxapi.cn', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://www.dmxapi.cn', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'aggregator', isPartner: true },
  { name: 'Compshare', websiteUrl: 'https://www.compshare.cn', apiKeyUrl: 'https://www.compshare.cn/coding-plan?ytag=GPU_YY_YX_git_cc-switch', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.modelverse.cn', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'aggregator', isPartner: true, icon: 'ucloud' },
  { name: 'OpenRouter', websiteUrl: 'https://openrouter.ai', apiKeyUrl: 'https://openrouter.ai/keys', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'anthropic/claude-sonnet-4.6', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'anthropic/claude-haiku-4.5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'anthropic/claude-sonnet-4.6', ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic/claude-opus-4.6' } }, category: 'aggregator', icon: 'openrouter', iconColor: '#6566F1' },
  { name: 'Novita AI', websiteUrl: 'https://novita.ai', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.novita.ai/anthropic', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'zai-org/glm-5', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'zai-org/glm-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'zai-org/glm-5', ANTHROPIC_DEFAULT_OPUS_MODEL: 'zai-org/glm-5' } }, category: 'aggregator', icon: 'novita' },
  { name: 'Nvidia', websiteUrl: 'https://build.nvidia.com', apiKeyUrl: 'https://build.nvidia.com/settings/api-keys', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://integrate.api.nvidia.com', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_MODEL: 'moonshotai/kimi-k2.5', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'moonshotai/kimi-k2.5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'moonshotai/kimi-k2.5', ANTHROPIC_DEFAULT_OPUS_MODEL: 'moonshotai/kimi-k2.5' } }, category: 'aggregator', icon: 'nvidia' },
  // ---- third_party ----
  { name: 'PackyCode', websiteUrl: 'https://www.packyapi.com', apiKeyUrl: 'https://www.packyapi.com/register?aff=cc-switch', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://www.packyapi.com', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'third_party', isPartner: true, icon: 'packycode' },
  { name: 'Cubence', websiteUrl: 'https://cubence.com', apiKeyUrl: 'https://cubence.com/signup?code=CCSWITCH&source=ccs', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.cubence.com', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'third_party', isPartner: true, icon: 'cubence', iconColor: '#000000' },
  { name: 'AIGoCode', websiteUrl: 'https://aigocode.com', apiKeyUrl: 'https://aigocode.com/invite/CC-SWITCH', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.aigocode.com', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'third_party', isPartner: true, icon: 'aigocode', iconColor: '#5B7FFF' },
  { name: 'RightCode', websiteUrl: 'https://www.right.codes', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://www.right.codes/claude', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'third_party', isPartner: true, icon: 'rc', iconColor: '#E96B2C' },
  { name: 'AICodeMirror', websiteUrl: 'https://www.aicodemirror.com', apiKeyUrl: 'https://www.aicodemirror.com/register?invitecode=9915W3', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.aicodemirror.com/api/claudecode', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'third_party', isPartner: true, icon: 'aicodemirror' },
  { name: 'AICoding', websiteUrl: 'https://aicoding.sh', apiKeyUrl: 'https://aicoding.sh/i/CCSWITCH', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.aicoding.sh', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'third_party', isPartner: true, icon: 'aicoding' },
  { name: 'CrazyRouter', websiteUrl: 'https://www.crazyrouter.com', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://crazyrouter.com', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'third_party', isPartner: true, icon: 'crazyrouter' },
  { name: 'SSSAiCode', websiteUrl: 'https://www.sssaicode.com', apiKeyUrl: 'https://www.sssaicode.com/register?ref=DCP0SM', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://node-hk.sssaicode.com/api', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'third_party', isPartner: true, icon: 'sssaicode' },
  { name: 'Micu', websiteUrl: 'https://www.openclaudecode.cn', apiKeyUrl: 'https://www.openclaudecode.cn/register?aff=aOYQ', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://www.openclaudecode.cn', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'third_party', isPartner: true, icon: 'micu' },
  { name: 'X-Code API', websiteUrl: 'https://x-code.cc', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://x-code.cc', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'third_party', isPartner: true, icon: 'x-code' },
  { name: 'CTok.ai', websiteUrl: 'https://ctok.ai', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.ctok.ai', ANTHROPIC_AUTH_TOKEN: '' } }, category: 'third_party', isPartner: true, icon: 'ctok' },
  { name: 'GitHub Copilot', websiteUrl: 'https://github.com/features/copilot', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.githubcopilot.com', ANTHROPIC_MODEL: 'claude-opus-4.6', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4.5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4.6', ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4.6' } }, category: 'third_party', icon: 'github', iconColor: '#000000' },
];

/* =========================================================================
 * CODEX PRESETS — settingsConfig = { auth, config }
 * auth → ~/.codex/auth.json, config → ~/.codex/config.toml
 * ========================================================================= */

function codexThirdPartyConfig(name: string, baseUrl: string, model = 'gpt-5.4'): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'custom';
  return `model_provider = "${clean}"\nmodel = "${model}"\nmodel_reasoning_effort = "high"\ndisable_response_storage = true\n\n[model_providers.${clean}]\nname = "${clean}"\nbase_url = "${baseUrl}"\nwire_api = "responses"\nrequires_openai_auth = true`;
}

export const CODEX_PRESETS: AppPreset[] = [
  { name: 'OpenAI Official', websiteUrl: 'https://chatgpt.com/codex', settingsConfig: { auth: {}, config: '' }, isOfficial: true, category: 'official', icon: 'openai', iconColor: '#00A67E' },
  { name: 'Azure OpenAI', websiteUrl: 'https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/codex', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: 'model_provider = "azure"\nmodel = "gpt-5.4"\nmodel_reasoning_effort = "high"\ndisable_response_storage = true\n\n[model_providers.azure]\nname = "Azure OpenAI"\nbase_url = "https://YOUR_RESOURCE_NAME.openai.azure.com/openai"\nenv_key = "OPENAI_API_KEY"\nquery_params = { "api-version" = "2025-04-01-preview" }\nwire_api = "responses"\nrequires_openai_auth = true' }, isOfficial: true, category: 'third_party', icon: 'azure', iconColor: '#0078D4' },
  // ---- aggregator ----
  { name: 'AiHubMix', websiteUrl: 'https://aihubmix.com', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('aihubmix', 'https://aihubmix.com/v1') }, category: 'aggregator' },
  { name: 'DMXAPI', websiteUrl: 'https://www.dmxapi.cn', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('dmxapi', 'https://www.dmxapi.cn/v1') }, category: 'aggregator', isPartner: true },
  { name: 'Compshare', websiteUrl: 'https://www.compshare.cn', apiKeyUrl: 'https://www.compshare.cn/coding-plan?ytag=GPU_YY_YX_git_cc-switch', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('compshare', 'https://api.modelverse.cn/v1') }, category: 'aggregator', isPartner: true, icon: 'ucloud' },
  { name: 'OpenRouter', websiteUrl: 'https://openrouter.ai', apiKeyUrl: 'https://openrouter.ai/keys', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('openrouter', 'https://openrouter.ai/api/v1') }, category: 'aggregator', icon: 'openrouter', iconColor: '#6566F1' },
  // ---- third_party ----
  { name: 'PackyCode', websiteUrl: 'https://www.packyapi.com', apiKeyUrl: 'https://www.packyapi.com/register?aff=cc-switch', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('packycode', 'https://www.packyapi.com/v1') }, category: 'third_party', isPartner: true, icon: 'packycode' },
  { name: 'Cubence', websiteUrl: 'https://cubence.com', apiKeyUrl: 'https://cubence.com/signup?code=CCSWITCH&source=ccs', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('cubence', 'https://api.cubence.com/v1') }, category: 'third_party', isPartner: true, icon: 'cubence', iconColor: '#000000' },
  { name: 'AIGoCode', websiteUrl: 'https://aigocode.com', apiKeyUrl: 'https://aigocode.com/invite/CC-SWITCH', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('aigocode', 'https://api.aigocode.com') }, category: 'third_party', isPartner: true, icon: 'aigocode', iconColor: '#5B7FFF' },
  { name: 'RightCode', websiteUrl: 'https://www.right.codes', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('rightcode', 'https://right.codes/codex/v1') }, category: 'third_party', isPartner: true, icon: 'rc', iconColor: '#E96B2C' },
  { name: 'AICodeMirror', websiteUrl: 'https://www.aicodemirror.com', apiKeyUrl: 'https://www.aicodemirror.com/register?invitecode=9915W3', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('aicodemirror', 'https://api.aicodemirror.com/api/codex/backend-api/codex') }, category: 'third_party', isPartner: true, icon: 'aicodemirror' },
  { name: 'AICoding', websiteUrl: 'https://aicoding.sh', apiKeyUrl: 'https://aicoding.sh/i/CCSWITCH', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('aicoding', 'https://api.aicoding.sh') }, category: 'third_party', isPartner: true, icon: 'aicoding' },
  { name: 'CrazyRouter', websiteUrl: 'https://www.crazyrouter.com', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('crazyrouter', 'https://crazyrouter.com/v1') }, category: 'third_party', isPartner: true, icon: 'crazyrouter' },
  { name: 'SSSAiCode', websiteUrl: 'https://www.sssaicode.com', apiKeyUrl: 'https://www.sssaicode.com/register?ref=DCP0SM', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('sssaicode', 'https://node-hk.sssaicode.com/api/v1') }, category: 'third_party', isPartner: true, icon: 'sssaicode' },
  { name: 'Micu', websiteUrl: 'https://www.openclaudecode.cn', apiKeyUrl: 'https://www.openclaudecode.cn/register?aff=aOYQ', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('micu', 'https://www.openclaudecode.cn/v1') }, category: 'third_party', isPartner: true, icon: 'micu' },
  { name: 'X-Code API', websiteUrl: 'https://x-code.cc', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('x-code', 'https://x-code.cc/v1') }, category: 'third_party', isPartner: true, icon: 'x-code' },
  { name: 'CTok.ai', websiteUrl: 'https://ctok.ai', settingsConfig: { auth: { OPENAI_API_KEY: '' }, config: codexThirdPartyConfig('ctok', 'https://api.ctok.ai/v1') }, category: 'third_party', isPartner: true, icon: 'ctok' },
];

/* =========================================================================
 * GEMINI PRESETS — settingsConfig.env → ~/.gemini/settings.json
 * ========================================================================= */
export const GEMINI_PRESETS: AppPreset[] = [
  { name: 'Google Official', websiteUrl: 'https://ai.google.dev/', apiKeyUrl: 'https://aistudio.google.com/apikey', settingsConfig: { env: {} }, isOfficial: true, category: 'official', icon: 'gemini', iconColor: '#4285F4' },
  // ---- third_party ----
  { name: 'PackyCode', websiteUrl: 'https://www.packyapi.com', apiKeyUrl: 'https://www.packyapi.com/register?aff=cc-switch', settingsConfig: { env: { GOOGLE_GEMINI_BASE_URL: 'https://www.packyapi.com', GEMINI_MODEL: 'gemini-3.1-pro' } }, category: 'third_party', isPartner: true, icon: 'packycode' },
  { name: 'Cubence', websiteUrl: 'https://cubence.com', apiKeyUrl: 'https://cubence.com/signup?code=CCSWITCH&source=ccs', settingsConfig: { env: { GOOGLE_GEMINI_BASE_URL: 'https://api.cubence.com', GEMINI_MODEL: 'gemini-3.1-pro' } }, category: 'third_party', isPartner: true, icon: 'cubence', iconColor: '#000000' },
  { name: 'AIGoCode', websiteUrl: 'https://aigocode.com', apiKeyUrl: 'https://aigocode.com/invite/CC-SWITCH', settingsConfig: { env: { GOOGLE_GEMINI_BASE_URL: 'https://api.aigocode.com', GEMINI_MODEL: 'gemini-3.1-pro' } }, category: 'third_party', isPartner: true, icon: 'aigocode', iconColor: '#5B7FFF' },
  { name: 'AICodeMirror', websiteUrl: 'https://www.aicodemirror.com', apiKeyUrl: 'https://www.aicodemirror.com/register?invitecode=9915W3', settingsConfig: { env: { GOOGLE_GEMINI_BASE_URL: 'https://api.aicodemirror.com/api/gemini', GEMINI_MODEL: 'gemini-3.1-pro' } }, category: 'third_party', isPartner: true, icon: 'aicodemirror' },
  { name: 'AICoding', websiteUrl: 'https://aicoding.sh', apiKeyUrl: 'https://aicoding.sh/i/CCSWITCH', settingsConfig: { env: { GOOGLE_GEMINI_BASE_URL: 'https://api.aicoding.sh', GEMINI_MODEL: 'gemini-3.1-pro' } }, category: 'third_party', isPartner: true, icon: 'aicoding' },
  { name: 'CrazyRouter', websiteUrl: 'https://www.crazyrouter.com', settingsConfig: { env: { GOOGLE_GEMINI_BASE_URL: 'https://crazyrouter.com', GEMINI_MODEL: 'gemini-3.1-pro' } }, category: 'third_party', isPartner: true, icon: 'crazyrouter' },
  { name: 'SSSAiCode', websiteUrl: 'https://www.sssaicode.com', apiKeyUrl: 'https://www.sssaicode.com/register?ref=DCP0SM', settingsConfig: { env: { GOOGLE_GEMINI_BASE_URL: 'https://node-hk.sssaicode.com/api', GEMINI_MODEL: 'gemini-3.1-pro' } }, category: 'third_party', isPartner: true, icon: 'sssaicode' },
  { name: 'CTok.ai', websiteUrl: 'https://ctok.ai', settingsConfig: { env: { GOOGLE_GEMINI_BASE_URL: 'https://api.ctok.ai/v1beta', GEMINI_MODEL: 'gemini-3.1-pro' } }, category: 'third_party', isPartner: true, icon: 'ctok' },
  // ---- aggregator ----
  { name: 'OpenRouter', websiteUrl: 'https://openrouter.ai', apiKeyUrl: 'https://openrouter.ai/keys', settingsConfig: { env: { GOOGLE_GEMINI_BASE_URL: 'https://openrouter.ai/api', GEMINI_MODEL: 'gemini-3.1-pro' } }, category: 'aggregator', icon: 'openrouter', iconColor: '#6566F1' },
];

/* =========================================================================
 * OPENCODE PRESETS — settingsConfig = { npm, options, models }
 * Written to ~/.opencode/config.json
 * ========================================================================= */
export const OPENCODE_PRESETS: AppPreset[] = [
  { name: 'DeepSeek', websiteUrl: 'https://platform.deepseek.com', apiKeyUrl: 'https://platform.deepseek.com/api_keys', settingsConfig: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://api.deepseek.com/v1', apiKey: '' }, models: { 'deepseek-chat': { name: 'DeepSeek V3.2' }, 'deepseek-reasoner': { name: 'DeepSeek R1' } } }, category: 'cn_official', icon: 'deepseek', iconColor: '#1E88E5' },
  { name: 'Zhipu GLM', websiteUrl: 'https://open.bigmodel.cn', settingsConfig: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '' }, models: { 'glm-5': { name: 'GLM-5' } } }, category: 'cn_official', icon: 'zhipu', iconColor: '#0F62FE' },
  { name: 'Zhipu GLM en', websiteUrl: 'https://z.ai', settingsConfig: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://api.z.ai/v1', apiKey: '' }, models: { 'glm-5': { name: 'GLM-5' } } }, category: 'cn_official', icon: 'zhipu', iconColor: '#0F62FE' },
  { name: 'Bailian', websiteUrl: 'https://bailian.console.aliyun.com', settingsConfig: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '' }, models: {} }, category: 'cn_official', icon: 'bailian', iconColor: '#624AFF' },
  { name: 'Kimi k2.5', websiteUrl: 'https://platform.moonshot.cn/console', settingsConfig: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://api.moonshot.cn/v1', apiKey: '' }, models: { 'kimi-k2.5': { name: 'Kimi K2.5' } } }, category: 'cn_official', icon: 'kimi', iconColor: '#6366F1' },
  { name: 'Kimi For Coding', websiteUrl: 'https://www.kimi.com/coding/docs/', settingsConfig: { npm: '@ai-sdk/anthropic', options: { baseURL: 'https://api.kimi.com/coding/v1', apiKey: '' }, models: { 'kimi-for-coding': { name: 'Kimi For Coding' } } }, category: 'cn_official', icon: 'kimi', iconColor: '#6366F1' },
  { name: 'StepFun', websiteUrl: 'https://platform.stepfun.ai', settingsConfig: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://api.stepfun.ai/v1', apiKey: '' }, models: { 'step-3.5-flash': { name: 'Step 3.5 Flash' } } }, category: 'cn_official', icon: 'stepfun', iconColor: '#005AFF' },
  { name: 'ModelScope', websiteUrl: 'https://modelscope.cn', settingsConfig: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://api-inference.modelscope.cn/v1', apiKey: '' }, models: { 'ZhipuAI/GLM-5': { name: 'GLM-5' } } }, category: 'aggregator', icon: 'modelscope', iconColor: '#624AFF' },
  { name: 'KAT-Coder', websiteUrl: 'https://console.streamlake.ai', settingsConfig: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://vanchin.streamlake.ai/api/gateway/v1/endpoints/openai', apiKey: '' }, models: { 'KAT-Coder-Pro': { name: 'KAT-Coder Pro' } } }, category: 'cn_official', icon: 'catcoder' },
  { name: 'MiniMax', websiteUrl: 'https://platform.minimaxi.com', settingsConfig: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://api.minimaxi.com/v1', apiKey: '' }, models: { 'MiniMax-M2.7': { name: 'MiniMax M2.7' } } }, category: 'cn_official', isPartner: true, icon: 'minimax', iconColor: '#FF6B6B' },
  { name: 'MiniMax en', websiteUrl: 'https://platform.minimax.io', settingsConfig: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://api.minimax.io/v1', apiKey: '' }, models: { 'MiniMax-M2.7': { name: 'MiniMax M2.7' } } }, category: 'cn_official', isPartner: true, icon: 'minimax', iconColor: '#FF6B6B' },
];

/* =========================================================================
 * OPENCLAW PRESETS — settingsConfig = { baseUrl, apiKey, api, models }
 * Written to ~/.openclaw/config.json
 * ========================================================================= */
export const OPENCLAW_PRESETS: AppPreset[] = [
  { name: 'DeepSeek', websiteUrl: 'https://platform.deepseek.com', settingsConfig: { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', api: 'openai-completions', models: [{ id: 'deepseek-chat', name: 'DeepSeek V3.2' }, { id: 'deepseek-reasoner', name: 'DeepSeek R1' }] }, category: 'cn_official', icon: 'deepseek', iconColor: '#1E88E5' },
  { name: 'Zhipu GLM', websiteUrl: 'https://open.bigmodel.cn', settingsConfig: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '', api: 'openai-completions', models: [{ id: 'glm-5', name: 'GLM-5' }] }, category: 'cn_official', icon: 'zhipu', iconColor: '#0F62FE' },
  { name: 'Zhipu GLM en', websiteUrl: 'https://z.ai', settingsConfig: { baseUrl: 'https://api.z.ai/v1', apiKey: '', api: 'openai-completions', models: [{ id: 'glm-5', name: 'GLM-5' }] }, category: 'cn_official', icon: 'zhipu', iconColor: '#0F62FE' },
  { name: 'Qwen Coder', websiteUrl: 'https://bailian.console.aliyun.com', settingsConfig: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', api: 'openai-completions', models: [{ id: 'qwen3.5-plus', name: 'Qwen3.5 Plus' }] }, category: 'cn_official', icon: 'qwen', iconColor: '#FF6A00' },
  { name: 'Kimi k2.5', websiteUrl: 'https://platform.moonshot.cn/console', settingsConfig: { baseUrl: 'https://api.moonshot.cn/v1', apiKey: '', api: 'openai-completions', models: [{ id: 'kimi-k2.5', name: 'Kimi K2.5' }] }, category: 'cn_official', icon: 'kimi', iconColor: '#6366F1' },
  { name: 'Kimi For Coding', websiteUrl: 'https://www.kimi.com/coding/docs/', settingsConfig: { baseUrl: 'https://api.kimi.com/v1', apiKey: '', api: 'openai-completions', models: [{ id: 'kimi-for-coding', name: 'Kimi For Coding' }] }, category: 'cn_official', icon: 'kimi', iconColor: '#6366F1' },
  { name: 'StepFun', websiteUrl: 'https://platform.stepfun.ai', settingsConfig: { baseUrl: 'https://api.stepfun.ai/v1', apiKey: '', api: 'openai-completions', models: [{ id: 'step-3.5-flash', name: 'Step 3.5 Flash' }] }, category: 'cn_official', icon: 'stepfun', iconColor: '#005AFF' },
  { name: 'MiniMax', websiteUrl: 'https://platform.minimaxi.com', settingsConfig: { baseUrl: 'https://api.minimaxi.com/v1', apiKey: '', api: 'openai-completions', models: [{ id: 'MiniMax-M2.7', name: 'MiniMax M2.7' }] }, category: 'cn_official', isPartner: true, icon: 'minimax', iconColor: '#FF6B6B' },
  { name: 'MiniMax en', websiteUrl: 'https://platform.minimax.io', settingsConfig: { baseUrl: 'https://api.minimax.io/v1', apiKey: '', api: 'openai-completions', models: [{ id: 'MiniMax-M2.7', name: 'MiniMax M2.7' }] }, category: 'cn_official', isPartner: true, icon: 'minimax', iconColor: '#FF6B6B' },
];

/* =========================================================================
 * UNIVERSAL PRESETS — cross-app (Claude + Codex + Gemini)
 * ========================================================================= */
export interface UniversalPreset {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  websiteUrl?: string;
  icon?: string;
  iconColor?: string;
  description?: string;
  models: {
    claude?: { model?: string; haikuModel?: string; sonnetModel?: string; opusModel?: string };
    codex?: { model?: string; reasoningEffort?: string };
    gemini?: { model?: string };
  };
}

export const UNIVERSAL_PRESETS: UniversalPreset[] = [
  {
    id: 'newapi', name: 'NewAPI', providerType: 'newapi', baseUrl: 'https://api.newapi.pro',
    websiteUrl: 'https://www.newapi.pro', icon: 'newapi', iconColor: '#00A67E',
    description: '跨应用统一配置，自动同步到 Claude、Codex、Gemini。',
    models: {
      claude: { model: 'claude-sonnet-4-20250514', haikuModel: 'claude-haiku-4-20250514', sonnetModel: 'claude-sonnet-4-20250514', opusModel: 'claude-sonnet-4-20250514' },
      codex: { model: 'gpt-5.4', reasoningEffort: 'high' },
      gemini: { model: 'gemini-2.5-pro' },
    },
  },
  {
    id: 'custom_gateway', name: '自定义网关', providerType: 'custom_gateway', baseUrl: '',
    icon: 'openai', iconColor: '#6366F1', description: '自定义配置的 API 网关。',
    models: {
      claude: { model: 'claude-sonnet-4-20250514', haikuModel: 'claude-haiku-4-20250514', sonnetModel: 'claude-sonnet-4-20250514', opusModel: 'claude-sonnet-4-20250514' },
      codex: { model: 'gpt-5.4', reasoningEffort: 'high' },
      gemini: { model: 'gemini-2.5-pro' },
    },
  },
];

/* =========================================================================
 * Per-app preset map + category order
 * ========================================================================= */
export type AppKey = 'claude' | 'codex' | 'gemini' | 'opencode' | 'openclaw';

export const APP_PRESETS: Record<AppKey, AppPreset[]> = {
  claude: CLAUDE_PRESETS,
  codex: CODEX_PRESETS,
  gemini: GEMINI_PRESETS,
  opencode: OPENCODE_PRESETS,
  openclaw: OPENCLAW_PRESETS,
};

export const PRESET_CATEGORY_ORDER: PresetCategory[] = [
  'official', 'cn_official', 'cloud_provider', 'aggregator', 'third_party', 'custom',
];

/* =========================================================================
 * Helpers: extract API key / base URL from settingsConfig per app
 * ========================================================================= */
export function extractApiKey(app: AppKey, sc: Record<string, any>): string {
  switch (app) {
    case 'claude': return sc?.env?.ANTHROPIC_AUTH_TOKEN ?? sc?.env?.ANTHROPIC_API_KEY ?? '';
    case 'codex': return sc?.auth?.OPENAI_API_KEY ?? '';
    case 'gemini': return sc?.env?.GEMINI_API_KEY ?? '';
    case 'opencode': return sc?.options?.apiKey ?? '';
    case 'openclaw': return sc?.apiKey ?? '';
    default: return '';
  }
}

export function setApiKey(app: AppKey, sc: Record<string, any>, key: string): Record<string, any> {
  const copy = JSON.parse(JSON.stringify(sc));
  switch (app) {
    case 'claude':
      if (!copy.env) copy.env = {};
      if ('ANTHROPIC_API_KEY' in copy.env) copy.env.ANTHROPIC_API_KEY = key;
      else copy.env.ANTHROPIC_AUTH_TOKEN = key;
      break;
    case 'codex':
      if (!copy.auth) copy.auth = {};
      copy.auth.OPENAI_API_KEY = key;
      break;
    case 'gemini':
      if (!copy.env) copy.env = {};
      copy.env.GEMINI_API_KEY = key;
      break;
    case 'opencode':
      if (!copy.options) copy.options = {};
      copy.options.apiKey = key;
      break;
    case 'openclaw':
      copy.apiKey = key;
      break;
  }
  return copy;
}

export function extractBaseUrl(app: AppKey, sc: Record<string, any>): string {
  switch (app) {
    case 'claude': return sc?.env?.ANTHROPIC_BASE_URL ?? '';
    case 'codex': {
      const m = sc?.config?.match?.(/base_url\s*=\s*"([^"]+)"/);
      return m?.[1] ?? '';
    }
    case 'gemini': return sc?.env?.GOOGLE_GEMINI_BASE_URL ?? '';
    case 'opencode': return sc?.options?.baseURL ?? '';
    case 'openclaw': return sc?.baseUrl ?? '';
    default: return '';
  }
}
