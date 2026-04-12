import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { parse as parseToml } from "smol-toml";
import {
  updateTomlCommonConfigSnippet,
  hasTomlCommonConfigSnippet,
} from "../../../lib/providerConfigUtils";
import { normalizeTomlText } from "../../../lib/textNormalization";

const STORAGE_KEY_PREFIX = "gwshell:common-config-snippet:";
const DEFAULT_CODEX_COMMON_CONFIG_SNIPPET = `# Common Codex config
# Add your common TOML configuration here`;

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

interface UseCodexCommonConfigProps {
  codexConfig: string;
  onConfigChange: (config: string) => void;
  initialData?: {
    settingsConfig?: Record<string, unknown>;
  };
  initialEnabled?: boolean;
  selectedPresetId?: string;
}

/**
 * 管理 Codex 通用配置片段 (TOML 格式)
 * GWShell adaptation: uses localStorage instead of VSCode configApi
 */
export function useCodexCommonConfig({
  codexConfig,
  onConfigChange,
  initialData,
  initialEnabled,
  selectedPresetId,
}: UseCodexCommonConfigProps) {
  const { t } = useTranslation('ai');
  const [useCommonConfig, setUseCommonConfig] = useState(false);
  const [commonConfigSnippet, setCommonConfigSnippetState] = useState<string>(
    DEFAULT_CODEX_COMMON_CONFIG_SNIPPET,
  );
  const [commonConfigError, setCommonConfigError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);

  const isUpdatingFromCommonConfig = useRef(false);
  const hasInitializedNewMode = useRef(false);
  const hasInitializedEditMode = useRef(false);

  useEffect(() => {
    hasInitializedNewMode.current = false;
    hasInitializedEditMode.current = false;
  }, [selectedPresetId, initialEnabled]);

  const parseCommonConfigSnippet = useCallback((snippetString: string) => {
    const trimmed = snippetString.trim();
    if (!trimmed) {
      return { hasContent: false };
    }

    try {
      const parsed = parseToml(normalizeTomlText(snippetString)) as Record<
        string,
        unknown
      >;
      return { hasContent: Object.keys(parsed).length > 0 };
    } catch (error) {
      return {
        hasContent: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, []);

  useEffect(() => {
    const stored = loadSnippetFromStorage("codex");
    if (stored && stored.trim()) {
      setCommonConfigSnippetState(stored);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (
      !initialData?.settingsConfig ||
      isLoading ||
      hasInitializedEditMode.current
    ) {
      return;
    }

    hasInitializedEditMode.current = true;

    const parsedSnippet = parseCommonConfigSnippet(commonConfigSnippet);
    if (parsedSnippet.error) {
      if (commonConfigSnippet.trim()) {
        setCommonConfigError(parsedSnippet.error);
      }
      setUseCommonConfig(false);
      return;
    }

    const config =
      typeof initialData.settingsConfig.config === "string"
        ? initialData.settingsConfig.config
        : "";
    const inferredHasCommon = hasTomlCommonConfigSnippet(
      config,
      commonConfigSnippet,
    );
    const hasCommon = initialEnabled ?? inferredHasCommon;

    if (hasCommon && !inferredHasCommon) {
      const { updatedConfig, error } = updateTomlCommonConfigSnippet(
        codexConfig,
        commonConfigSnippet,
        true,
      );
      if (error) {
        setCommonConfigError(error);
        setUseCommonConfig(false);
        return;
      }

      setCommonConfigError("");
      setUseCommonConfig(true);
      isUpdatingFromCommonConfig.current = true;
      onConfigChange(updatedConfig);
      setTimeout(() => {
        isUpdatingFromCommonConfig.current = false;
      }, 0);
      return;
    }

    setCommonConfigError("");
    setUseCommonConfig(hasCommon);
  }, [
    codexConfig,
    commonConfigSnippet,
    initialData,
    initialEnabled,
    isLoading,
    onConfigChange,
    parseCommonConfigSnippet,
  ]);

  useEffect(() => {
    if (initialData || isLoading || hasInitializedNewMode.current) {
      return;
    }

    hasInitializedNewMode.current = true;

    const parsedSnippet = parseCommonConfigSnippet(commonConfigSnippet);
    if (parsedSnippet.error) {
      if (commonConfigSnippet.trim()) {
        setCommonConfigError(parsedSnippet.error);
      }
      setUseCommonConfig(false);
      return;
    }
    if (!parsedSnippet.hasContent) {
      return;
    }

    const { updatedConfig, error } = updateTomlCommonConfigSnippet(
      codexConfig,
      commonConfigSnippet,
      true,
    );
    if (error) {
      setCommonConfigError(error);
      setUseCommonConfig(false);
      return;
    }

    setCommonConfigError("");
    setUseCommonConfig(true);
    isUpdatingFromCommonConfig.current = true;
    onConfigChange(updatedConfig);
    setTimeout(() => {
      isUpdatingFromCommonConfig.current = false;
    }, 0);
  }, [
    initialData,
    commonConfigSnippet,
    isLoading,
    codexConfig,
    onConfigChange,
    parseCommonConfigSnippet,
  ]);

  const handleCommonConfigToggle = useCallback(
    (checked: boolean) => {
      const parsedSnippet = parseCommonConfigSnippet(commonConfigSnippet);
      if (parsedSnippet.error) {
        setCommonConfigError(parsedSnippet.error);
        setUseCommonConfig(false);
        return;
      }
      if (!parsedSnippet.hasContent) {
        setCommonConfigError(
          t("codexConfig.noCommonConfigToApply", {
            defaultValue: "通用配置片段为空或没有可写入的内容",
          }),
        );
        setUseCommonConfig(false);
        return;
      }

      const { updatedConfig, error: snippetError } =
        updateTomlCommonConfigSnippet(
          codexConfig,
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
    [
      codexConfig,
      commonConfigSnippet,
      onConfigChange,
      parseCommonConfigSnippet,
      t,
    ],
  );

  const handleCommonConfigSnippetChange = useCallback(
    (value: string): boolean => {
      const previousSnippet = commonConfigSnippet;

      if (!value.trim()) {
        setCommonConfigError("");

        if (useCommonConfig) {
          const previousParsed = parseCommonConfigSnippet(previousSnippet);
          let updatedConfig = codexConfig;

          if (!previousParsed.error && previousParsed.hasContent) {
            const removeResult = updateTomlCommonConfigSnippet(
              codexConfig,
              previousSnippet,
              false,
            );
            if (removeResult.error) {
              setCommonConfigError(removeResult.error);
              return false;
            }
            updatedConfig = removeResult.updatedConfig;
          }

          onConfigChange(updatedConfig);
          setUseCommonConfig(false);
        }

        setCommonConfigSnippetState("");
        saveSnippetToStorage("codex", "");
        return true;
      }

      const parsedNextSnippet = parseCommonConfigSnippet(value);
      if (parsedNextSnippet.error) {
        setCommonConfigError(parsedNextSnippet.error);
        return false;
      }

      if (useCommonConfig) {
        let nextConfig = codexConfig;
        const previousParsed = parseCommonConfigSnippet(previousSnippet);

        if (!previousParsed.error && previousParsed.hasContent) {
          const removeResult = updateTomlCommonConfigSnippet(
            codexConfig,
            previousSnippet,
            false,
          );
          if (removeResult.error) {
            setCommonConfigError(removeResult.error);
            return false;
          }
          nextConfig = removeResult.updatedConfig;
        }

        const addResult = updateTomlCommonConfigSnippet(
          nextConfig,
          value,
          true,
        );

        if (addResult.error) {
          setCommonConfigError(addResult.error);
          return false;
        }

        isUpdatingFromCommonConfig.current = true;
        onConfigChange(addResult.updatedConfig);
        setTimeout(() => {
          isUpdatingFromCommonConfig.current = false;
        }, 0);
      }

      setCommonConfigError("");
      setCommonConfigSnippetState(value);
      saveSnippetToStorage("codex", value);
      return true;
    },
    [
      commonConfigSnippet,
      codexConfig,
      onConfigChange,
      parseCommonConfigSnippet,
      useCommonConfig,
    ],
  );

  useEffect(() => {
    if (isUpdatingFromCommonConfig.current || isLoading) {
      return;
    }
    const parsedSnippet = parseCommonConfigSnippet(commonConfigSnippet);
    if (parsedSnippet.error) {
      setUseCommonConfig(false);
      return;
    }
    const hasCommon = hasTomlCommonConfigSnippet(
      codexConfig,
      commonConfigSnippet,
    );
    setUseCommonConfig(hasCommon);
  }, [codexConfig, commonConfigSnippet, isLoading, parseCommonConfigSnippet]);

  // Stub extraction: no backend in GWShell
  const handleExtract = useCallback(async () => {
    setIsExtracting(true);
    setCommonConfigError("");

    try {
      if (!codexConfig || !codexConfig.trim()) {
        setCommonConfigError(
          t("codexConfig.extractNoCommonConfig", {
            defaultValue: "没有找到可提取的通用配置",
          }),
        );
        return;
      }

      setCommonConfigSnippetState(codexConfig.trim());
      saveSnippetToStorage("codex", codexConfig.trim());
    } catch (error) {
      setCommonConfigError(
        t("codexConfig.extractFailed", {
          error: String(error),
          defaultValue: `提取失败: ${String(error)}`,
        }),
      );
    } finally {
      setIsExtracting(false);
    }
  }, [codexConfig, t]);

  const clearCommonConfigError = useCallback(() => {
    setCommonConfigError("");
  }, []);

  return {
    useCommonConfig,
    commonConfigSnippet,
    commonConfigError,
    isLoading,
    isExtracting,
    handleCommonConfigToggle,
    handleCommonConfigSnippetChange,
    handleExtract,
    clearCommonConfigError,
  };
}
