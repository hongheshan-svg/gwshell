import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  updateCommonConfigSnippet,
  hasCommonConfigSnippet,
  validateJsonConfig,
} from "../../../lib/providerConfigUtils";

const STORAGE_KEY_PREFIX = "gwshell:common-config-snippet:";
const DEFAULT_COMMON_CONFIG_SNIPPET = `{
  "includeCoAuthoredBy": false
}`;

function loadSnippetFromStorage(appType: string): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY_PREFIX + appType) || "";
  } catch {
    return "";
  }
}

function saveSnippetToStorage(appType: string, value: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY_PREFIX + appType, value);
  } catch {
    // ignore
  }
}

interface UseCommonConfigSnippetProps {
  settingsConfig: string;
  onConfigChange: (config: string) => void;
  initialData?: {
    settingsConfig?: Record<string, unknown>;
  };
  initialEnabled?: boolean;
  selectedPresetId?: string;
  enabled?: boolean;
}

/**
 * 管理 Claude 通用配置片段
 * GWShell adaptation: uses localStorage instead of VSCode configApi
 */
export function useCommonConfigSnippet({
  settingsConfig,
  onConfigChange,
  initialData,
  initialEnabled,
  selectedPresetId,
  enabled = true,
}: UseCommonConfigSnippetProps) {
  const { t } = useTranslation('ai');
  const [useCommonConfig, setUseCommonConfig] = useState(false);
  const [commonConfigSnippet, setCommonConfigSnippetState] = useState<string>(
    DEFAULT_COMMON_CONFIG_SNIPPET,
  );
  const [commonConfigError, setCommonConfigError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);

  const isUpdatingFromCommonConfig = useRef(false);
  const hasInitializedNewMode = useRef(false);
  const hasInitializedEditMode = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    hasInitializedNewMode.current = false;
    hasInitializedEditMode.current = false;
  }, [selectedPresetId, enabled, initialEnabled]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    const stored = loadSnippetFromStorage("claude");
    if (stored && stored.trim()) {
      setCommonConfigSnippetState(stored);
    }
    setIsLoading(false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (initialData && !isLoading) {
      const configString = JSON.stringify(initialData.settingsConfig, null, 2);
      const inferredHasCommon = hasCommonConfigSnippet(
        configString,
        commonConfigSnippet,
      );
      const hasCommon = initialEnabled ?? inferredHasCommon;
      setUseCommonConfig(hasCommon);

      if (hasCommon && !inferredHasCommon && !hasInitializedEditMode.current) {
        hasInitializedEditMode.current = true;
        const { updatedConfig, error } = updateCommonConfigSnippet(
          settingsConfig,
          commonConfigSnippet,
          true,
        );
        if (!error) {
          isUpdatingFromCommonConfig.current = true;
          onConfigChange(updatedConfig);
          setTimeout(() => {
            isUpdatingFromCommonConfig.current = false;
          }, 0);
        }
      } else {
        hasInitializedEditMode.current = true;
      }
    }
  }, [
    enabled,
    initialData,
    initialEnabled,
    commonConfigSnippet,
    isLoading,
    onConfigChange,
    settingsConfig,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (!initialData && !isLoading && !hasInitializedNewMode.current) {
      hasInitializedNewMode.current = true;

      try {
        const snippetObj = JSON.parse(commonConfigSnippet);
        const hasContent = Object.keys(snippetObj).length > 0;
        if (hasContent) {
          setUseCommonConfig(true);
          const { updatedConfig, error } = updateCommonConfigSnippet(
            settingsConfig,
            commonConfigSnippet,
            true,
          );
          if (!error) {
            isUpdatingFromCommonConfig.current = true;
            onConfigChange(updatedConfig);
            setTimeout(() => {
              isUpdatingFromCommonConfig.current = false;
            }, 0);
          }
        }
      } catch {
        // ignore parse error
      }
    }
  }, [
    enabled,
    initialData,
    commonConfigSnippet,
    isLoading,
    settingsConfig,
    onConfigChange,
  ]);

  const handleCommonConfigToggle = useCallback(
    (checked: boolean) => {
      const { updatedConfig, error: snippetError } = updateCommonConfigSnippet(
        settingsConfig,
        commonConfigSnippet,
        checked,
      );

      if (snippetError) {
        setCommonConfigError(snippetError);
        setUseCommonConfig(false);
        return;
      }

      setCommonConfigError("");
      setUseCommonConfig(checked);
      isUpdatingFromCommonConfig.current = true;
      onConfigChange(updatedConfig);
      setTimeout(() => {
        isUpdatingFromCommonConfig.current = false;
      }, 0);
    },
    [settingsConfig, commonConfigSnippet, onConfigChange],
  );

  const handleCommonConfigSnippetChange = useCallback(
    (value: string) => {
      const previousSnippet = commonConfigSnippet;
      setCommonConfigSnippetState(value);

      if (!value.trim()) {
        setCommonConfigError("");
        saveSnippetToStorage("claude", "");

        if (useCommonConfig) {
          const { updatedConfig } = updateCommonConfigSnippet(
            settingsConfig,
            previousSnippet,
            false,
          );
          onConfigChange(updatedConfig);
          setUseCommonConfig(false);
        }
        return;
      }

      const validationError = validateJsonConfig(value, "通用配置片段");
      if (validationError) {
        setCommonConfigError(validationError);
      } else {
        setCommonConfigError("");
        saveSnippetToStorage("claude", value);
      }

      if (useCommonConfig && !validationError) {
        const removeResult = updateCommonConfigSnippet(
          settingsConfig,
          previousSnippet,
          false,
        );
        if (removeResult.error) {
          setCommonConfigError(removeResult.error);
          return;
        }
        const addResult = updateCommonConfigSnippet(
          removeResult.updatedConfig,
          value,
          true,
        );

        if (addResult.error) {
          setCommonConfigError(addResult.error);
          return;
        }

        isUpdatingFromCommonConfig.current = true;
        onConfigChange(addResult.updatedConfig);
        setTimeout(() => {
          isUpdatingFromCommonConfig.current = false;
        }, 0);
      }
    },
    [commonConfigSnippet, settingsConfig, useCommonConfig, onConfigChange],
  );

  useEffect(() => {
    if (!enabled) return;
    if (isUpdatingFromCommonConfig.current || isLoading) {
      return;
    }
    const hasCommon = hasCommonConfigSnippet(
      settingsConfig,
      commonConfigSnippet,
    );
    setUseCommonConfig(hasCommon);
  }, [enabled, settingsConfig, commonConfigSnippet, isLoading]);

  // Stub: extraction not fully supported in GWShell without backend
  const handleExtract = useCallback(async () => {
    setIsExtracting(true);
    setCommonConfigError("");

    try {
      // Best-effort: extract keys from current config that are not standard Claude keys
      const config = JSON.parse(settingsConfig || "{}");
      const standardKeys = new Set(["env", "mcpServers", "projects"]);
      const extracted: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(config)) {
        if (!standardKeys.has(k)) {
          extracted[k] = v;
        }
      }

      if (Object.keys(extracted).length === 0) {
        setCommonConfigError(
          t("claudeConfig.extractNoCommonConfig", {
            defaultValue: "没有找到可提取的通用配置",
          }),
        );
        return;
      }

      const extractedStr = JSON.stringify(extracted, null, 2);
      setCommonConfigSnippetState(extractedStr);
      saveSnippetToStorage("claude", extractedStr);
    } catch (error) {
      setCommonConfigError(
        t("claudeConfig.extractFailed", {
          error: String(error),
          defaultValue: `提取失败: ${String(error)}`,
        }),
      );
    } finally {
      setIsExtracting(false);
    }
  }, [settingsConfig, t]);

  return {
    useCommonConfig,
    commonConfigSnippet,
    commonConfigError,
    isLoading,
    isExtracting,
    handleCommonConfigToggle,
    handleCommonConfigSnippetChange,
    handleExtract,
  };
}
