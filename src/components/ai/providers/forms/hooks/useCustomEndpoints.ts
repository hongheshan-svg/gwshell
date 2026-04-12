import { useMemo } from "react";
import type { AppId } from "../../../lib/api";
import type { CustomEndpoint } from "../../../lib/types";

interface ProviderPresetLike {
  endpointCandidates?: string[];
  [key: string]: unknown;
}

type PresetEntry = {
  id: string;
  preset: ProviderPresetLike;
};

interface UseCustomEndpointsProps {
  appId: AppId;
  selectedPresetId: string | null;
  presetEntries: PresetEntry[];
  draftCustomEndpoints: string[];
  baseUrl: string;
  codexBaseUrl: string;
}

/**
 * 收集和管理自定义端点
 */
export function useCustomEndpoints({
  appId,
  selectedPresetId,
  presetEntries,
  draftCustomEndpoints,
  baseUrl,
  codexBaseUrl,
}: UseCustomEndpointsProps) {
  const customEndpointsMap = useMemo(() => {
    const urlSet = new Set<string>();

    const push = (raw?: string) => {
      const url = (raw || "").trim().replace(/\/+$/, "");
      if (url) urlSet.add(url);
    };

    for (const u of draftCustomEndpoints) push(u);

    if (selectedPresetId && selectedPresetId !== "custom") {
      const entry = presetEntries.find((item) => item.id === selectedPresetId);
      if (entry) {
        const preset = entry.preset as ProviderPresetLike;
        if (Array.isArray(preset?.endpointCandidates)) {
          for (const u of preset.endpointCandidates as string[]) push(u);
        }
      }
    }

    if (appId === "codex") {
      push(codexBaseUrl);
    } else {
      push(baseUrl);
    }

    const urls = Array.from(urlSet.values());
    if (urls.length === 0) {
      return null;
    }

    const now = Date.now();
    const customMap: Record<string, CustomEndpoint> = {};
    for (const url of urls) {
      if (!customMap[url]) {
        customMap[url] = { url, addedAt: now, lastUsed: undefined };
      }
    }

    return customMap;
  }, [
    appId,
    selectedPresetId,
    presetEntries,
    draftCustomEndpoints,
    baseUrl,
    codexBaseUrl,
  ]);

  return customEndpointsMap;
}
