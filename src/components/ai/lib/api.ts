/**
 * GWShell AI Provider API adapter
 *
 * Wraps Tauri IPC invoke() calls for AI provider management.
 * All backend commands are defined in src-tauri/src/ai_config.rs and
 * registered in src-tauri/src/lib.rs.
 */

import { invoke } from "@tauri-apps/api/core";

// ============================================================
// Types
// ============================================================

export type AppId = "claude" | "codex" | "gemini" | "opencode" | "openclaw";

export interface AiProvider {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  apps: {
    claude: boolean;
    codex: boolean;
    gemini: boolean;
    opencode: boolean;
    openclaw: boolean;
  };
  models: {
    claude?: {
      model?: string;
      haikuModel?: string;
      sonnetModel?: string;
      opusModel?: string;
    };
    codex?: {
      model?: string;
      reasoningEffort?: string;
    };
    gemini?: {
      model?: string;
    };
    opencode?: {
      model?: string;
    };
    openclaw?: {
      model?: string;
    };
  };
  settingsConfig?: Record<string, any>;
  category?: string;
  websiteUrl?: string;
  notes?: string;
  icon?: string;
  iconColor?: string;
  enabled: boolean;
  isPartner?: boolean;
  customHeaders?: Record<string, string>;
  createdAt?: number;
  sortIndex?: number;
  meta?: any;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Convert the active-IDs tuple returned by `get_ai_active_ids` to a
 * record keyed by AppId for convenient lookup.
 *
 * Backend returns: [claude, codex, gemini, opencode, openclaw]
 */
export function activeIdsToRecord(
  ids: [
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
  ],
): Record<AppId, string | undefined> {
  const [claude, codex, gemini, opencode, openclaw] = ids;
  return {
    claude: claude ?? undefined,
    codex: codex ?? undefined,
    gemini: gemini ?? undefined,
    opencode: opencode ?? undefined,
    openclaw: openclaw ?? undefined,
  };
}

// ============================================================
// API object
// ============================================================

export const providersApi = {
  /**
   * List all AI providers, optionally filtered to those that support a
   * specific app (where `provider.apps[appId] === true`).
   */
  async list(appId?: AppId): Promise<AiProvider[]> {
    const all = await invoke<AiProvider[]>("list_ai_providers");
    if (!appId) return all;
    return all.filter((p) => p.apps[appId] === true);
  },

  /** Persist (create or update) a provider. */
  async save(provider: AiProvider): Promise<void> {
    await invoke("save_ai_provider", { provider });
  },

  /** Delete a provider by ID. */
  async delete(providerId: string): Promise<void> {
    await invoke("delete_ai_provider", { providerId });
  },

  /**
   * Switch the active provider for one or all tools.
   *
   * @param providerId  The provider to activate.
   * @param tool        Which tool to switch: 'claude' | 'codex' | 'gemini' |
   *                    'opencode' | 'openclaw' | 'all'
   */
  async switch(
    providerId: string,
    tool: AppId | "all",
  ): Promise<void> {
    await invoke("switch_ai_provider", { providerId, tool });
  },

  /**
   * Get the currently active provider IDs for each tool.
   * Returns a tuple [claude, codex, gemini, opencode, openclaw].
   * Use `activeIdsToRecord()` to convert to a keyed record.
   */
  async getActiveIds(): Promise<
    [string | null, string | null, string | null, string | null, string | null]
  > {
    return invoke("get_ai_active_ids");
  },

  /**
   * Import providers from a CC Switch configuration file.
   * Returns the list of imported providers.
   */
  async importFromCcSwitch(): Promise<AiProvider[]> {
    return invoke("import_from_cc_switch");
  },
} as const;
