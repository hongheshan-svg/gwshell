import { useState, useEffect, useCallback, useMemo } from "react";
import { applyTemplateValues } from "../../../lib/providerConfigUtils";
import type { TemplateValueConfig } from '../../../config/claudeProviderPresets';

type TemplatePath = Array<string | number>;
type TemplateValueMap = Record<string, TemplateValueConfig>;

interface ProviderPresetLike {
  settingsConfig?: Record<string, unknown>;
  templateValues?: Record<string, TemplateValueConfig>;
  name?: string;
  providerType?: string;
  requiresOAuth?: boolean;
}

interface PresetEntry {
  id: string;
  preset: ProviderPresetLike;
}

interface UseTemplateValuesProps {
  selectedPresetId: string | null;
  presetEntries: PresetEntry[];
  settingsConfig: string;
  onConfigChange: (config: string) => void;
}

/**
 * 收集配置中包含模板占位符的路径
 */
const collectTemplatePaths = (
  source: unknown,
  templateKeys: string[],
  currentPath: TemplatePath = [],
  acc: TemplatePath[] = [],
): TemplatePath[] => {
  if (typeof source === "string") {
    const hasPlaceholder = templateKeys.some((key) =>
      source.includes(`\${${key}}`),
    );
    if (hasPlaceholder) {
      acc.push([...currentPath]);
    }
    return acc;
  }

  if (Array.isArray(source)) {
    source.forEach((item, index) =>
      collectTemplatePaths(item, templateKeys, [...currentPath, index], acc),
    );
    return acc;
  }

  if (source && typeof source === "object") {
    Object.entries(source).forEach(([key, value]) =>
      collectTemplatePaths(value, templateKeys, [...currentPath, key], acc),
    );
  }

  return acc;
};

const getValueAtPath = (source: unknown, path: TemplatePath): unknown => {
  return path.reduce<unknown>((acc, key) => {
    if (acc === undefined || acc === null) {
      return undefined;
    }
    return (acc as Record<string | number, unknown>)[key];
  }, source);
};

const setValueAtPath = (
  target: unknown,
  path: TemplatePath,
  value: unknown,
): unknown => {
  if (path.length === 0) {
    return value;
  }

  const obj = target as Record<string | number, unknown>;
  let current = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const nextKey = path[i + 1];
    const isNextIndex = typeof nextKey === "number";

    if ((current as Record<string | number, unknown>)[key] === undefined) {
      (current as Record<string | number, unknown>)[key] = isNextIndex
        ? []
        : {};
    } else {
      const currentValue = (current as Record<string | number, unknown>)[key];
      if (isNextIndex && !Array.isArray(currentValue)) {
        (current as Record<string | number, unknown>)[key] = [];
      } else if (
        !isNextIndex &&
        (typeof currentValue !== "object" || currentValue === null)
      ) {
        (current as Record<string | number, unknown>)[key] = {};
      }
    }

    current = (current as Record<string | number, unknown>)[
      key
    ] as Record<string | number, unknown>;
  }

  const finalKey = path[path.length - 1];
  (current as Record<string | number, unknown>)[finalKey] = value;
  return target;
};

const applyTemplateValuesToConfigString = (
  presetConfig: unknown,
  currentConfigString: string,
  values: TemplateValueMap,
) => {
  const replacedConfig = applyTemplateValues(
    presetConfig as Record<string, unknown>,
    values as any,
  );
  const templateKeys = Object.keys(values);
  if (templateKeys.length === 0) {
    return JSON.stringify(replacedConfig, null, 2);
  }

  const placeholderPaths = collectTemplatePaths(presetConfig, templateKeys);

  try {
    const parsedConfig = currentConfigString.trim()
      ? JSON.parse(currentConfigString)
      : {};
    let targetConfig: unknown;
    if (Array.isArray(parsedConfig)) {
      targetConfig = [...parsedConfig];
    } else if (parsedConfig && typeof parsedConfig === "object") {
      targetConfig = JSON.parse(JSON.stringify(parsedConfig));
    } else {
      targetConfig = {};
    }

    if (placeholderPaths.length === 0) {
      return JSON.stringify(targetConfig, null, 2);
    }

    let mutatedConfig = targetConfig;

    for (const path of placeholderPaths) {
      const nextValue = getValueAtPath(replacedConfig, path);
      if (path.length === 0) {
        mutatedConfig = nextValue;
      } else {
        setValueAtPath(mutatedConfig, path, nextValue);
      }
    }

    return JSON.stringify(mutatedConfig, null, 2);
  } catch {
    return JSON.stringify(replacedConfig, null, 2);
  }
};

/**
 * 管理模板变量的状态和逻辑
 */
export function useTemplateValues({
  selectedPresetId,
  presetEntries,
  settingsConfig,
  onConfigChange,
}: UseTemplateValuesProps) {
  const [templateValues, setTemplateValues] = useState<TemplateValueMap>({});

  const selectedPreset = useMemo(() => {
    if (!selectedPresetId || selectedPresetId === "custom") {
      return null;
    }
    const entry = presetEntries.find((item) => item.id === selectedPresetId);
    if (entry && "settingsConfig" in entry.preset) {
      return entry.preset as ProviderPresetLike;
    }
    return null;
  }, [selectedPresetId, presetEntries]);

  const templateValueEntries = useMemo(() => {
    if (!selectedPreset?.templateValues) {
      return [];
    }
    return Object.entries(selectedPreset.templateValues) as Array<
      [string, TemplateValueConfig]
    >;
  }, [selectedPreset]);

  useEffect(() => {
    if (selectedPreset?.templateValues) {
      const initialValues = Object.fromEntries(
        Object.entries(selectedPreset.templateValues).map(([key, config]) => [
          key,
          {
            ...config,
            editorValue: config.editorValue || config.defaultValue || "",
          },
        ]),
      );
      setTemplateValues(initialValues);
    } else {
      setTemplateValues({});
    }
  }, [selectedPreset]);

  const handleTemplateValueChange = useCallback(
    (key: string, value: string) => {
      if (!selectedPreset?.templateValues) {
        return;
      }

      const config = selectedPreset.templateValues[key];
      if (!config) {
        return;
      }

      setTemplateValues((prev) => {
        const prevEntry = prev[key];
        const nextEntry: TemplateValueConfig = {
          ...config,
          ...(prevEntry ?? {}),
          editorValue: value,
        };
        const nextValues: TemplateValueMap = {
          ...prev,
          [key]: nextEntry,
        };

        try {
          const configString = applyTemplateValuesToConfigString(
            selectedPreset.settingsConfig,
            settingsConfig,
            nextValues,
          );
          onConfigChange(configString);
        } catch (err) {
          console.error("更新模板值失败:", err);
        }

        return nextValues;
      });
    },
    [selectedPreset, settingsConfig, onConfigChange],
  );

  const validateTemplateValues = useCallback((): {
    isValid: boolean;
    missingField?: { key: string; label: string };
  } => {
    if (templateValueEntries.length === 0) {
      return { isValid: true };
    }

    for (const [key, config] of templateValueEntries) {
      const entry = templateValues[key];
      const resolvedValue = (
        entry?.editorValue ??
        entry?.defaultValue ??
        config.defaultValue ??
        ""
      ).trim();
      if (!resolvedValue) {
        return {
          isValid: false,
          missingField: { key, label: config.label },
        };
      }
    }

    return { isValid: true };
  }, [templateValueEntries, templateValues]);

  return {
    templateValues,
    templateValueEntries,
    selectedPreset,
    handleTemplateValueChange,
    validateTemplateValues,
  };
}
