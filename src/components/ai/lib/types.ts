/**
 * Shared types for the AI provider management UI.
 * Extracted from CC Switch's src/types.ts — only the subset needed by preset/form files.
 */

export type ProviderCategory =
  | "official" // 官方
  | "cn_official" // 开源官方（原"国产官方"）
  | "cloud_provider" // 云服务商（AWS Bedrock 等）
  | "aggregator" // 聚合网站
  | "third_party" // 第三方供应商
  | "custom" // 自定义
  | "omo" // Oh My OpenCode
  | "omo-slim"; // Oh My OpenCode Slim

export interface Provider {
  id: string;
  name: string;
  settingsConfig: Record<string, any>;
  websiteUrl?: string;
  category?: ProviderCategory;
  createdAt?: number;
  sortIndex?: number;
  notes?: string;
  isPartner?: boolean;
  meta?: ProviderMeta;
  icon?: string;
  iconColor?: string;
  inFailoverQueue?: boolean;
}

// 供应商单独的模型测试配置
export interface ProviderTestConfig {
  enabled: boolean;
  testModel?: string;
  timeoutSecs?: number;
  testPrompt?: string;
  degradedThresholdMs?: number;
  maxRetries?: number;
}

// 供应商单独的代理配置
export interface ProviderProxyConfig {
  enabled: boolean;
  proxyType?: "http" | "https" | "socks5";
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
}

// Claude API 格式类型
export type ClaudeApiFormat = "anthropic" | "openai_chat" | "openai_responses";

// Claude 认证字段类型
export type ClaudeApiKeyField = "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";

// 供应商元数据
export interface ProviderMeta {
  custom_endpoints?: Record<string, { url: string; addedAt: number; lastUsed?: number }>;
  commonConfigEnabled?: boolean;
  usage_script?: Record<string, any>;
  endpointAutoSelect?: boolean;
  isPartner?: boolean;
  partnerPromotionKey?: string;
  testConfig?: ProviderTestConfig;
  proxyConfig?: ProviderProxyConfig;
  costMultiplier?: string;
  pricingModelSource?: string;
  apiFormat?: ClaudeApiFormat;
  authBinding?: { source: "provider_config" | "managed_account"; authProvider?: string; accountId?: string };
  apiKeyField?: ClaudeApiKeyField;
  isFullUrl?: boolean;
  promptCacheKey?: string;
  providerType?: string;
  githubAccountId?: string;
}

// Claude 模型配置
export interface ClaudeModelConfig {
  model?: string;
  haikuModel?: string;
  sonnetModel?: string;
  opusModel?: string;
}

// Codex 模型配置
export interface CodexModelConfig {
  model?: string;
  reasoningEffort?: string;
}

// Gemini 模型配置
export interface GeminiModelConfig {
  model?: string;
}

// 各应用的模型配置（统一供应商）
export interface UniversalProviderModels {
  claude?: ClaudeModelConfig;
  codex?: CodexModelConfig;
  gemini?: GeminiModelConfig;
}

// 统一供应商的应用启用状态
export interface UniversalProviderApps {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}

// 统一供应商（跨应用共享配置）
export interface UniversalProvider {
  id: string;
  name: string;
  providerType: string;
  apps: UniversalProviderApps;
  baseUrl: string;
  apiKey: string;
  models: UniversalProviderModels;
  websiteUrl?: string;
  notes?: string;
  icon?: string;
  iconColor?: string;
  meta?: ProviderMeta;
  createdAt?: number;
  sortIndex?: number;
}

// OpenCode 供应商选项
export interface OpenCodeProviderOptions {
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

// OpenCode 模型条目
export interface OpenCodeModel {
  name: string;
  limit?: { context?: number; output?: number };
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

// OpenCode 供应商配置（settings_config 结构）
export interface OpenCodeProviderConfig {
  npm: string;
  name?: string;
  options: OpenCodeProviderOptions;
  models: Record<string, OpenCodeModel>;
}

// OpenClaw 供应商配置（settings_config 结构）
export interface OpenClawProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  models?: OpenClawModel[];
  headers?: Record<string, string>;
  authHeader?: boolean;
}

// OpenClaw 模型配置
export interface OpenClawModel {
  id: string;
  name: string;
  alias?: string;
  reasoning?: boolean;
  input?: string[];
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow?: number;
  maxTokens?: number;
}

// OpenClaw 默认模型配置
export interface OpenClawDefaultModel {
  primary: string;
  fallbacks?: string[];
}

// Endpoint candidate for speed testing
export interface EndpointCandidate {
  id?: string;
  url: string;
  isCustom?: boolean;
}

// Custom endpoint entry (persisted)
export interface CustomEndpoint {
  url: string;
  addedAt: number;
  lastUsed?: number;
}
