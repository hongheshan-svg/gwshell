import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";

const STORAGE_KEY_PREFIX = "gwshell:common-config-snippet:";
const DEFAULT_GEMINI_COMMON_CONFIG_SNIPPET = "{}";

const GEMINI_COMMON_ENV_FORBIDDEN_KEYS = [
  "GOOGLE_GEMINI_BASE_URL",
  "GEMINI_API_KEY",
] as const;
type GeminiForbiddenEnvKey = (typeof GEMINI_COMMON_ENV_FORBIDDEN_KEYS)[number];

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

interface UseGeminiCommonConfigProps {
  envValue: string;
  onEnvChange: (env: string) => void;
  envStringToObj: (envString: string) => Record<string, string>;
  envObjToString: (envObj: Record<string, unknown>) => string;
  initialData?: {
    settingsConfig?: Record<string, unknown>;
  };
  initialEnabled?: boolean;
  selectedPresetId?: string;
}

/**
 * 管理 Gemini 通用配置片段 (JSON 格式)
 * GWShell adaptation: uses localStorage instead of VSCode configApi
 */
export function useGeminiCommonConfig({
  envValue,
  onEnvChange,
  envStringToObj,
  envObjToString,
  initialData,
  initialEnabled,
  selectedPresetId,
}: UseGeminiCommonConfigProps) {
  const { t } = useTranslation('ai');
  const [useCommonConfig, setUseCommonConfig] = useState(false);
  const [commonConfigSnippet, setCommonConfigSnippetState] = useState<string>(
    DEFAULT_GEMINI_COMMON_CONFIG_SNIPPET,
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

  const parseSnippetEnv = useCallback(
    (
      snippetString: string,
    ): { env: Record<string, string>; error?: string } => {
      const trimmed = snippetString.trim();
      if (!trimmed) {
        return { env: {} };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return { env: {}, error: t("geminiConfig.invalidJsonFormat", { defaultValue: "Invalid JSON format" }) };
      }

      if (!isPlainObject(parsed)) {
        return { env: {}, error: t("geminiConfig.invalidJsonFormat", { defaultValue: "Invalid JSON format" }) };
      }

      const keys = Object.keys(parsed);
      const forbiddenKeys = keys.filter((key) =>
        GEMINI_COMMON_ENV_FORBIDDEN_KEYS.includes(key as GeminiForbiddenEnvKey),
      );
      if (forbiddenKeys.length > 0) {
        return {
          env: {},
          error: t("geminiConfig.commonConfigInvalidKeys", {
            keys: forbiddenKeys.join(", "),
            defaultValue: `Cannot include keys: ${forbiddenKeys.join(", ")}`,
          }),
        };
      }

      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== "string") {
          return {
            env: {},
            error: t("geminiConfig.commonConfigInvalidValues", { defaultValue: "All values must be strings" }),
          };
        }
        const normalized = value.trim();
        if (!normalized) continue;
        env[key] = normalized;
      }

      return { env };
    },
    [t],
  );

  const hasEnvCommonConfigSnippet = useCallback(
    (envObj: Record<string, string>, snippetEnv: Record<string, string>) => {
      const entries = Object.entries(snippetEnv);
      if (entries.length === 0) return false;
      return entries.every(([key, value]) => envObj[key] === value);
    },
    [],
  );

  const applySnippetToEnv = useCallback(
    (envObj: Record<string, string>, snippetEnv: Record<string, string>) => {
      const updated = { ...envObj };
      for (const [key, value] of Object.entries(snippetEnv)) {
        if (typeof value === "string") {
          updated[key] = value;
        }
      }
      return updated;
    },
    [],
  );

  const removeSnippetFromEnv = useCallback(
    (envObj: Record<string, string>, snippetEnv: Record<string, string>) => {
      const updated = { ...envObj };
      for (const [key, value] of Object.entries(snippetEnv)) {
        if (typeof value === "string" && updated[key] === value) {
          delete updated[key];
        }
      }
      return updated;
    },
    [],
  );

  useEffect(() => {
    const stored = loadSnippetFromStorage("gemini");
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

    try {
      const env =
        isPlainObject(initialData.settingsConfig.env) &&
        Object.keys(initialData.settingsConfig.env).length > 0
          ? (initialData.settingsConfig.env as Record<string, string>)
          : {};
      const parsed = parseSnippetEnv(commonConfigSnippet);
      if (parsed.error) {
        if (commonConfigSnippet.trim()) {
          setCommonConfigError(parsed.error);
        }
        setUseCommonConfig(false);
        return;
      }
      const inferredHasCommon = hasEnvCommonConfigSnippet(
        env,
        parsed.env as Record<string, string>,
      );
      const hasCommon = initialEnabled ?? inferredHasCommon;

      if (hasCommon && !inferredHasCommon) {
        const currentEnv = envStringToObj(envValue);
        const merged = applySnippetToEnv(currentEnv, parsed.env);
        const nextEnvString = envObjToString(merged);

        setCommonConfigError("");
        setUseCommonConfig(true);
        isUpdatingFromCommonConfig.current = true;
        onEnvChange(nextEnvString);
        setTimeout(() => {
          isUpdatingFromCommonConfig.current = false;
        }, 0);
        return;
      }

      setCommonConfigError("");
      setUseCommonConfig(hasCommon);
    } catch {
      // ignore
    }
  }, [
    applySnippetToEnv,
    commonConfigSnippet,
    envObjToString,
    envStringToObj,
    envValue,
    hasEnvCommonConfigSnippet,
    initialData,
    initialEnabled,
    isLoading,
    onEnvChange,
    parseSnippetEnv,
  ]);

  useEffect(() => {
    if (initialData || isLoading || hasInitializedNewMode.current) {
      return;
    }

    hasInitializedNewMode.current = true;

    const parsed = parseSnippetEnv(commonConfigSnippet);
    if (parsed.error) {
      if (commonConfigSnippet.trim()) {
        setCommonConfigError(parsed.error);
      }
      setUseCommonConfig(false);
      return;
    }
    const hasContent = Object.keys(parsed.env).length > 0;
    if (!hasContent) return;

    setCommonConfigError("");
    setUseCommonConfig(true);
    const currentEnv = envStringToObj(envValue);
    const merged = applySnippetToEnv(currentEnv, parsed.env);
    const nextEnvString = envObjToString(merged);

    isUpdatingFromCommonConfig.current = true;
    onEnvChange(nextEnvString);
    setTimeout(() => {
      isUpdatingFromCommonConfig.current = false;
    }, 0);
  }, [
    initialData,
    isLoading,
    commonConfigSnippet,
    envValue,
    envStringToObj,
    envObjToString,
    applySnippetToEnv,
    onEnvChange,
    parseSnippetEnv,
  ]);

  const handleCommonConfigToggle = useCallback(
    (checked: boolean) => {
      const parsed = parseSnippetEnv(commonConfigSnippet);
      if (parsed.error) {
        setCommonConfigError(parsed.error);
        setUseCommonConfig(false);
        return;
      }
      if (Object.keys(parsed.env).length === 0) {
        setCommonConfigError(
          t("geminiConfig.noCommonConfigToApply", { defaultValue: "No common config to apply" }),
        );
        setUseCommonConfig(false);
        return;
      }

      const currentEnv = envStringToObj(envValue);
      const updatedEnvObj = checked
        ? applySnippetToEnv(currentEnv, parsed.env)
        : removeSnippetFromEnv(currentEnv, parsed.env);

      setCommonConfigError("");
      setUseCommonConfig(checked);

      isUpdatingFromCommonConfig.current = true;
      onEnvChange(envObjToString(updatedEnvObj));
      setTimeout(() => {
        isUpdatingFromCommonConfig.current = false;
      }, 0);
    },
    [
      applySnippetToEnv,
      commonConfigSnippet,
      envObjToString,
      envStringToObj,
      envValue,
      onEnvChange,
      parseSnippetEnv,
      removeSnippetFromEnv,
      t,
    ],
  );

  const handleCommonConfigSnippetChange = useCallback(
    (value: string): boolean => {
      const previousSnippet = commonConfigSnippet;

      if (!value.trim()) {
        setCommonConfigError("");

        if (useCommonConfig) {
          const parsedPrevious = parseSnippetEnv(previousSnippet);
          if (
            !parsedPrevious.error &&
            Object.keys(parsedPrevious.env).length > 0
          ) {
            const currentEnv = envStringToObj(envValue);
            const updatedEnv = removeSnippetFromEnv(
              currentEnv,
              parsedPrevious.env,
            );
            onEnvChange(envObjToString(updatedEnv));
          }
          setUseCommonConfig(false);
        }

        setCommonConfigSnippetState("");
        saveSnippetToStorage("gemini", "");
        return true;
      }

      const parsed = parseSnippetEnv(value);
      if (parsed.error) {
        setCommonConfigError(parsed.error);
        return false;
      }

      if (useCommonConfig) {
        const prevParsed = parseSnippetEnv(previousSnippet);
        const prevEnv = prevParsed.error ? {} : prevParsed.env;
        const nextEnv = parsed.env;
        const currentEnv = envStringToObj(envValue);

        const withoutOld =
          Object.keys(prevEnv).length > 0
            ? removeSnippetFromEnv(currentEnv, prevEnv)
            : currentEnv;
        const withNew =
          Object.keys(nextEnv).length > 0
            ? applySnippetToEnv(withoutOld, nextEnv)
            : withoutOld;

        isUpdatingFromCommonConfig.current = true;
        onEnvChange(envObjToString(withNew));
        setTimeout(() => {
          isUpdatingFromCommonConfig.current = false;
        }, 0);
      }

      setCommonConfigError("");
      setCommonConfigSnippetState(value);
      saveSnippetToStorage("gemini", value);
      return true;
    },
    [
      applySnippetToEnv,
      commonConfigSnippet,
      envObjToString,
      envStringToObj,
      envValue,
      onEnvChange,
      parseSnippetEnv,
      removeSnippetFromEnv,
      useCommonConfig,
    ],
  );

  useEffect(() => {
    if (isUpdatingFromCommonConfig.current || isLoading) {
      return;
    }
    const parsed = parseSnippetEnv(commonConfigSnippet);
    if (parsed.error) return;
    const envObj = envStringToObj(envValue);
    setUseCommonConfig(
      hasEnvCommonConfigSnippet(envObj, parsed.env as Record<string, string>),
    );
  }, [
    envValue,
    commonConfigSnippet,
    envStringToObj,
    hasEnvCommonConfigSnippet,
    isLoading,
    parseSnippetEnv,
  ]);

  // Stub extraction
  const handleExtract = useCallback(async () => {
    setIsExtracting(true);
    setCommonConfigError("");

    try {
      const currentEnv = envStringToObj(envValue);
      const extractable: Record<string, string> = {};
      for (const [k, v] of Object.entries(currentEnv)) {
        if (
          !GEMINI_COMMON_ENV_FORBIDDEN_KEYS.includes(k as GeminiForbiddenEnvKey)
        ) {
          extractable[k] = v;
        }
      }

      if (Object.keys(extractable).length === 0) {
        setCommonConfigError(
          t("geminiConfig.extractNoCommonConfig", { defaultValue: "No common config to extract" }),
        );
        return;
      }

      const extractedStr = JSON.stringify(extractable, null, 2);
      setCommonConfigSnippetState(extractedStr);
      saveSnippetToStorage("gemini", extractedStr);
    } catch (error) {
      setCommonConfigError(
        t("geminiConfig.extractFailed", {
          error: String(error),
          defaultValue: `Extract failed: ${String(error)}`,
        }),
      );
    } finally {
      setIsExtracting(false);
    }
  }, [envStringToObj, envValue, t]);

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
