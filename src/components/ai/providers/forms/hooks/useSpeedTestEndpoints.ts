import { useMemo } from "react";
import type { AppId } from "../../../lib/api";
import type { EndpointCandidate } from "../../../lib/types";
import { extractCodexBaseUrl } from "../../../lib/providerConfigUtils";

interface ProviderPresetLike {
  endpointCandidates?: string[];
  settingsConfig?: {
    env?: {
      ANTHROPIC_BASE_URL?: string;
      GOOGLE_GEMINI_BASE_URL?: string;
    };
  };
  config?: string;
  [key: string]: unknown;
}

type PresetEntry = {
  id: string;
  preset: ProviderPresetLike;
};

interface ProviderMeta {
  [key: string]: unknown;
}

interface UseSpeedTestEndpointsProps {
  appId: AppId;
  selectedPresetId: string | null;
  presetEntries: PresetEntry[];
  baseUrl: string;
  codexBaseUrl: string;
  initialData?: {
    settingsConfig?: Record<string, unknown>;
    meta?: ProviderMeta;
  };
}

/**
 * 收集端点测速弹窗的初始端点列表
 */
export function useSpeedTestEndpoints({
  appId,
  selectedPresetId,
  presetEntries,
  baseUrl,
  codexBaseUrl,
  initialData,
}: UseSpeedTestEndpointsProps) {
  const claudeEndpoints = useMemo<EndpointCandidate[]>(() => {
    if (appId !== "claude" && appId !== "gemini") return [];

    const map = new Map<string, EndpointCandidate>();
    const add = (url?: string, isCustom = false) => {
      if (!url) return;
      const sanitized = url.trim().replace(/\/+$/, "");
      if (!sanitized || map.has(sanitized)) return;
      map.set(sanitized, { url: sanitized, isCustom });
    };

    if (baseUrl) {
      add(baseUrl);
    }

    if (initialData && typeof initialData.settingsConfig === "object") {
      const configEnv = initialData.settingsConfig as {
        env?: { ANTHROPIC_BASE_URL?: string; GOOGLE_GEMINI_BASE_URL?: string };
      };
      const envUrls = [
        configEnv.env?.ANTHROPIC_BASE_URL,
        configEnv.env?.GOOGLE_GEMINI_BASE_URL,
      ];
      envUrls.forEach((u) => {
        if (typeof u === "string") add(u);
      });
    }

    if (selectedPresetId && selectedPresetId !== "custom") {
      const entry = presetEntries.find((item) => item.id === selectedPresetId);
      if (entry) {
        const preset = entry.preset as ProviderPresetLike;
        const presetEnv = preset.settingsConfig as {
          env?: {
            ANTHROPIC_BASE_URL?: string;
            GOOGLE_GEMINI_BASE_URL?: string;
          };
        };
        const presetUrls = [
          presetEnv?.env?.ANTHROPIC_BASE_URL,
          presetEnv?.env?.GOOGLE_GEMINI_BASE_URL,
        ];
        presetUrls.forEach((u) => add(u));
        if (preset.endpointCandidates) {
          preset.endpointCandidates.forEach((url) => add(url));
        }
      }
    }

    return Array.from(map.values());
  }, [appId, baseUrl, initialData, selectedPresetId, presetEntries]);

  const codexEndpoints = useMemo<EndpointCandidate[]>(() => {
    if (appId !== "codex") return [];

    const map = new Map<string, EndpointCandidate>();
    const add = (url?: string, isCustom = false) => {
      if (!url) return;
      const sanitized = url.trim().replace(/\/+$/, "");
      if (!sanitized || map.has(sanitized)) return;
      map.set(sanitized, { url: sanitized, isCustom });
    };

    if (codexBaseUrl) {
      add(codexBaseUrl);
    }

    const initialCodexConfig = initialData?.settingsConfig as
      | {
          config?: string;
        }
      | undefined;
    const configStr = initialCodexConfig?.config ?? "";
    const extractedBaseUrl = extractCodexBaseUrl(configStr);
    if (extractedBaseUrl) {
      add(extractedBaseUrl);
    }

    if (selectedPresetId && selectedPresetId !== "custom") {
      const entry = presetEntries.find((item) => item.id === selectedPresetId);
      if (entry) {
        const preset = entry.preset as ProviderPresetLike;
        const presetConfig = (preset.config as string) || "";
        const presetBaseUrl = extractCodexBaseUrl(presetConfig);
        if (presetBaseUrl) {
          add(presetBaseUrl);
        }
        if (preset.endpointCandidates) {
          preset.endpointCandidates.forEach((url) => add(url));
        }
      }
    }

    return Array.from(map.values());
  }, [appId, codexBaseUrl, initialData, selectedPresetId, presetEntries]);

  return appId === "codex" ? codexEndpoints : claudeEndpoints;
}
