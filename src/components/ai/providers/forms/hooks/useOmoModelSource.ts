import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { providersApi } from "../../../lib/api";
import type { AppId } from "../../../lib/api";
import type { OpenCodeProviderConfig } from "../../../lib/types";
import { OPENCODE_PRESET_MODEL_VARIANTS } from "../../../config/opencodeProviderPresets";
import { parseOpencodeConfigStrict } from "../helpers/opencodeFormUtils";

interface UseOmoModelSourceParams {
  isOmoCategory: boolean;
  providerId?: string;
}

interface OmoModelBuild {
  options: Array<{ value: string; label: string }>;
  variantsMap: Record<string, string[]>;
  presetMetaMap: Record<
    string,
    {
      options?: Record<string, unknown>;
      limit?: { context?: number; output?: number };
    }
  >;
  parseFailedProviders: string[];
  usedFallbackSource: boolean;
}

export interface OmoModelSourceResult {
  omoModelOptions: Array<{ value: string; label: string }>;
  omoModelVariantsMap: Record<string, string[]>;
  omoPresetMetaMap: Record<
    string,
    {
      options?: Record<string, unknown>;
      limit?: { context?: number; output?: number };
    }
  >;
  existingOpencodeKeys: string[];
}

export function useOmoModelSource({
  isOmoCategory,
  providerId,
}: UseOmoModelSourceParams): OmoModelSourceResult {
  const { t } = useTranslation('ai');

  // Load opencode providers from GWShell's providersApi
  const [opencodeProviders, setOpencodeProviders] = useState<
    Record<
      string,
      {
        name?: string;
        category?: string;
        settingsConfig?: Record<string, unknown>;
      }
    >
  >({});

  useEffect(() => {
    if (!isOmoCategory) return;
    providersApi.list("opencode" as AppId).then((providers) => {
      const map: typeof opencodeProviders = {};
      for (const p of providers) {
        map[p.id] = {
          name: p.name,
          category: p.category,
          settingsConfig: p.settingsConfig,
        };
      }
      setOpencodeProviders(map);
    }).catch((e) => {
      console.warn("[OmoModelSource] Failed to load opencode providers:", e);
    });
  }, [isOmoCategory]);

  const existingOpencodeKeys = useMemo(() => {
    return Object.keys(opencodeProviders).filter((k) => k !== providerId);
  }, [opencodeProviders, providerId]);

  const omoModelBuild = useMemo<OmoModelBuild>(() => {
    const empty: OmoModelBuild = {
      options: [],
      variantsMap: {},
      presetMetaMap: {},
      parseFailedProviders: [],
      usedFallbackSource: false,
    };
    if (!isOmoCategory) {
      return empty;
    }

    if (Object.keys(opencodeProviders).length === 0) {
      return empty;
    }

    const dedupedOptions = new Map<string, string>();
    const variantsMap: Record<string, string[]> = {};
    const presetMetaMap: Record<
      string,
      {
        options?: Record<string, unknown>;
        limit?: { context?: number; output?: number };
      }
    > = {};
    const parseFailedProviders: string[] = [];

    for (const [providerKey, provider] of Object.entries(opencodeProviders)) {
      if (provider.category === "omo" || provider.category === "omo-slim") {
        continue;
      }

      let parsedConfig: OpenCodeProviderConfig;
      try {
        parsedConfig = parseOpencodeConfigStrict(provider.settingsConfig);
      } catch (error) {
        parseFailedProviders.push(providerKey);
        console.warn(
          "[OMO_MODEL_SOURCE_PARSE_FAILED] failed to parse provider settings",
          { providerKey, error },
        );
        continue;
      }

      for (const [modelId, model] of Object.entries(
        parsedConfig.models || {},
      )) {
        const modelName =
          typeof model.name === "string" && model.name.trim()
            ? model.name
            : modelId;
        const providerDisplayName =
          typeof provider.name === "string" && provider.name.trim()
            ? provider.name
            : providerKey;
        const value = `${providerKey}/${modelId}`;
        const label = `${providerDisplayName} / ${modelName} (${modelId})`;
        if (!dedupedOptions.has(value)) {
          dedupedOptions.set(value, label);
        }

        const rawVariants = (model as Record<string, unknown>).variants;
        if (
          rawVariants &&
          typeof rawVariants === "object" &&
          !Array.isArray(rawVariants)
        ) {
          const variantKeys = Object.keys(rawVariants).filter(Boolean);
          if (variantKeys.length > 0) {
            variantsMap[value] = variantKeys;
          }
        }
      }

      const presetModels = OPENCODE_PRESET_MODEL_VARIANTS[parsedConfig.npm];
      if (presetModels) {
        for (const modelId of Object.keys(parsedConfig.models || {})) {
          const fullKey = `${providerKey}/${modelId}`;
          const preset = presetModels.find((p) => p.id === modelId);
          if (!preset) continue;

          if (!variantsMap[fullKey] && preset.variants) {
            const presetKeys = Object.keys(preset.variants).filter(Boolean);
            if (presetKeys.length > 0) {
              variantsMap[fullKey] = presetKeys;
            }
          }

          const meta: (typeof presetMetaMap)[string] = {};
          if (preset.options) meta.options = preset.options;
          if (preset.contextLimit || preset.outputLimit) {
            meta.limit = {};
            if (preset.contextLimit) meta.limit.context = preset.contextLimit;
            if (preset.outputLimit) meta.limit.output = preset.outputLimit;
          }
          if (Object.keys(meta).length > 0) {
            presetMetaMap[fullKey] = meta;
          }
        }
      }
    }

    return {
      options: Array.from(dedupedOptions.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
      variantsMap,
      presetMetaMap,
      parseFailedProviders,
      usedFallbackSource: false,
    };
  }, [isOmoCategory, opencodeProviders]);

  const lastWarningRef = useRef<string>("");
  useEffect(() => {
    if (!isOmoCategory) return;
    const failed = omoModelBuild.parseFailedProviders;
    if (failed.length === 0) return;

    const signature = failed.slice().sort().join(",");
    if (lastWarningRef.current === signature) return;
    lastWarningRef.current = signature;

    toast.warning(
      t("omo.modelSourcePartialWarning", {
        count: failed.length,
        defaultValue: "Some provider model configs are invalid and were skipped.",
      }),
    );
  }, [isOmoCategory, omoModelBuild.parseFailedProviders, t]);

  return {
    omoModelOptions: omoModelBuild.options,
    omoModelVariantsMap: omoModelBuild.variantsMap,
    omoPresetMetaMap: omoModelBuild.presetMetaMap,
    existingOpencodeKeys,
  };
}
