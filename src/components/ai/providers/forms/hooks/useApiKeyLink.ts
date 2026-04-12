import { useMemo } from "react";
import type { AppId } from "../../../lib/api";
import type { ProviderCategory } from "../../../lib/types";

interface ProviderPresetLike {
  category?: ProviderCategory;
  isOfficial?: boolean;
  isPartner?: boolean;
  partnerPromotionKey?: string;
  apiKeyUrl?: string;
  websiteUrl?: string;
}

type PresetEntry = {
  id: string;
  preset: ProviderPresetLike;
};

interface UseApiKeyLinkProps {
  appId: AppId;
  category?: ProviderCategory;
  selectedPresetId: string | null;
  presetEntries: PresetEntry[];
  formWebsiteUrl: string;
}

/**
 * 管理 API Key 获取链接的显示和 URL
 */
export function useApiKeyLink({
  appId,
  category,
  selectedPresetId,
  presetEntries,
  formWebsiteUrl,
}: UseApiKeyLinkProps) {
  const shouldShowApiKeyLink = useMemo(() => {
    return (
      category !== "official" &&
      (category === "cn_official" ||
        category === "aggregator" ||
        category === "third_party")
    );
  }, [category]);

  const currentPresetEntry = useMemo(() => {
    if (selectedPresetId && selectedPresetId !== "custom") {
      return presetEntries.find((item) => item.id === selectedPresetId);
    }
    return undefined;
  }, [selectedPresetId, presetEntries]);

  const getWebsiteUrl = useMemo(() => {
    if (currentPresetEntry) {
      const preset = currentPresetEntry.preset;
      if (
        preset.category === "cn_official" ||
        preset.category === "aggregator" ||
        preset.category === "third_party"
      ) {
        return preset.apiKeyUrl || preset.websiteUrl || "";
      }
      return preset.websiteUrl || "";
    }
    return formWebsiteUrl || "";
  }, [currentPresetEntry, formWebsiteUrl]);

  const isPartner = useMemo(() => {
    return currentPresetEntry?.preset.isPartner ?? false;
  }, [currentPresetEntry]);

  const partnerPromotionKey = useMemo(() => {
    return currentPresetEntry?.preset.partnerPromotionKey;
  }, [currentPresetEntry]);

  return {
    shouldShowApiKeyLink:
      appId === "claude" ||
      appId === "codex" ||
      appId === "gemini" ||
      appId === "opencode"
        ? shouldShowApiKeyLink
        : false,
    websiteUrl: getWebsiteUrl,
    isPartner,
    partnerPromotionKey,
  };
}
