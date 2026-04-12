import { useState, useEffect } from "react";
import type { ProviderCategory } from "../../../lib/types";
import type { AppId } from "../../../lib/api";
import { providerPresets } from "../../../config/claudeProviderPresets";
import { codexProviderPresets } from "../../../config/codexProviderPresets";
import { geminiProviderPresets } from "../../../config/geminiProviderPresets";
import { opencodeProviderPresets } from "../../../config/opencodeProviderPresets";

interface UseProviderCategoryProps {
  appId: AppId;
  selectedPresetId: string | null;
  isEditMode: boolean;
  initialCategory?: ProviderCategory;
}

/**
 * 管理供应商类别状态
 * 根据选择的预设自动更新类别
 */
export function useProviderCategory({
  appId,
  selectedPresetId,
  isEditMode,
  initialCategory,
}: UseProviderCategoryProps) {
  const [category, setCategory] = useState<ProviderCategory | undefined>(
    isEditMode ? initialCategory : undefined,
  );

  useEffect(() => {
    if (isEditMode) {
      setCategory(initialCategory);
      return;
    }

    if (selectedPresetId === "custom") {
      setCategory("custom");
      return;
    }

    if (!selectedPresetId) return;

    const match = selectedPresetId.match(
      /^(claude|codex|gemini|opencode)-(\d+)$/,
    );
    if (!match) return;

    const [, type, indexStr] = match;
    const index = parseInt(indexStr, 10);

    if (type === "codex" && appId === "codex") {
      const preset = codexProviderPresets[index];
      if (preset) {
        setCategory(
          preset.category || (preset.isOfficial ? "official" : undefined),
        );
      }
    } else if (type === "claude" && appId === "claude") {
      const preset = providerPresets[index];
      if (preset) {
        setCategory(
          preset.category || (preset.isOfficial ? "official" : undefined),
        );
      }
    } else if (type === "gemini" && appId === "gemini") {
      const preset = geminiProviderPresets[index];
      if (preset) {
        setCategory(preset.category || undefined);
      }
    } else if (type === "opencode" && appId === "opencode") {
      const preset = opencodeProviderPresets[index];
      if (preset) {
        setCategory(preset.category || undefined);
      }
    }
  }, [appId, selectedPresetId, isEditMode, initialCategory]);

  return { category, setCategory };
}
