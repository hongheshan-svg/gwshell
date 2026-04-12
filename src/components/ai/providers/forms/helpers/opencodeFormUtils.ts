import type { OpenCodeModel, OpenCodeProviderConfig } from "../../../lib/types";

// ── PricingModelSourceOption ─────────────────────────────────────────────────

export type PricingModelSourceOption = "inherit" | "request" | "response";

// ── Default configs ──────────────────────────────────────────────────────────

export const CLAUDE_DEFAULT_CONFIG = JSON.stringify({ env: {} }, null, 2);
export const CODEX_DEFAULT_CONFIG = JSON.stringify(
  { auth: {}, config: "" },
  null,
  2,
);
export const GEMINI_DEFAULT_CONFIG = JSON.stringify(
  {
    env: {
      GOOGLE_GEMINI_BASE_URL: "",
      GEMINI_API_KEY: "",
      GEMINI_MODEL: "gemini-3-pro-preview",
    },
  },
  null,
  2,
);

export const OPENCODE_DEFAULT_NPM = "@ai-sdk/openai-compatible";
export const OPENCODE_DEFAULT_CONFIG = JSON.stringify(
  {
    npm: OPENCODE_DEFAULT_NPM,
    options: {
      baseURL: "",
      apiKey: "",
      setCacheKey: true,
    },
    models: {},
  },
  null,
  2,
);
export const OPENCODE_KNOWN_OPTION_KEYS = [
  "baseURL",
  "apiKey",
  "headers",
] as const;

export const OPENCLAW_DEFAULT_CONFIG = JSON.stringify(
  {
    baseUrl: "",
    apiKey: "",
    api: "openai-completions",
    models: [],
  },
  null,
  2,
);

// ── Pure functions ───────────────────────────────────────────────────────────

export function isKnownOpencodeOptionKey(key: string): boolean {
  return OPENCODE_KNOWN_OPTION_KEYS.includes(
    key as (typeof OPENCODE_KNOWN_OPTION_KEYS)[number],
  );
}

export function parseOpencodeConfig(
  settingsConfig?: Record<string, unknown>,
): OpenCodeProviderConfig {
  const normalize = (
    parsed: Partial<OpenCodeProviderConfig>,
  ): OpenCodeProviderConfig => ({
    npm: parsed.npm || OPENCODE_DEFAULT_NPM,
    options:
      parsed.options && typeof parsed.options === "object"
        ? (parsed.options as OpenCodeProviderConfig["options"])
        : {},
    models:
      parsed.models && typeof parsed.models === "object"
        ? (parsed.models as Record<string, OpenCodeModel>)
        : {},
  });

  try {
    const parsed = JSON.parse(
      settingsConfig ? JSON.stringify(settingsConfig) : OPENCODE_DEFAULT_CONFIG,
    ) as Partial<OpenCodeProviderConfig>;
    return normalize(parsed);
  } catch {
    return {
      npm: OPENCODE_DEFAULT_NPM,
      options: {},
      models: {},
    };
  }
}

export function parseOpencodeConfigStrict(
  settingsConfig?: Record<string, unknown>,
): OpenCodeProviderConfig {
  const parsed = JSON.parse(
    settingsConfig ? JSON.stringify(settingsConfig) : OPENCODE_DEFAULT_CONFIG,
  ) as Partial<OpenCodeProviderConfig>;
  return {
    npm: parsed.npm || OPENCODE_DEFAULT_NPM,
    options:
      parsed.options && typeof parsed.options === "object"
        ? (parsed.options as OpenCodeProviderConfig["options"])
        : {},
    models:
      parsed.models && typeof parsed.models === "object"
        ? (parsed.models as Record<string, OpenCodeModel>)
        : {},
  };
}

export const OPENCODE_KNOWN_MODEL_KEYS = ["name", "limit", "options"] as const;

export function isKnownModelKey(key: string): boolean {
  return OPENCODE_KNOWN_MODEL_KEYS.includes(
    key as (typeof OPENCODE_KNOWN_MODEL_KEYS)[number],
  );
}

export function getModelExtraFields(
  model: OpenCodeModel,
): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(model)) {
    if (!isKnownModelKey(k)) {
      extra[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  return extra;
}

export function toOpencodeExtraOptions(
  options: OpenCodeProviderConfig["options"],
): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(options || {})) {
    if (!isKnownOpencodeOptionKey(k)) {
      extra[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  return extra;
}

/**
 * Stub for buildOmoProfilePreview - returns a minimal preview object.
 * Full OMO implementation requires @/types/omo which is CC Switch-specific.
 */
export function buildOmoProfilePreview(
  agents: Record<string, Record<string, unknown>>,
  categories: Record<string, Record<string, unknown>> | undefined,
  otherFieldsStr: string,
  options?: { slim?: boolean },
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const isSlim = options?.slim ?? false;

  if (Object.keys(agents).length > 0) result["agents"] = agents;
  if (!isSlim && categories && Object.keys(categories).length > 0)
    result["categories"] = categories;

  try {
    if (otherFieldsStr.trim()) {
      const other = JSON.parse(otherFieldsStr);
      Object.assign(result, other);
    }
  } catch {
    // ignore
  }

  return result;
}

/**
 * Slim version of buildOmoProfilePreview - excludes categories.
 */
export function buildOmoSlimProfilePreview(
  agents: Record<string, Record<string, unknown>>,
  otherFieldsStr: string,
): Record<string, unknown> {
  return buildOmoProfilePreview(agents, undefined, otherFieldsStr, {
    slim: true,
  });
}

export const normalizePricingSource = (
  value?: string,
): PricingModelSourceOption =>
  value === "request" || value === "response" ? value : "inherit";
