import { useState, useCallback } from "react";

/**
 * 管理 Gemini 配置状态
 * Gemini 配置包含两部分：env (环境变量) 和 config (扩展配置 JSON)
 */
export function useGeminiConfigState({
  initialData,
}: {
  initialData?: {
    settingsConfig?: Record<string, unknown>;
  };
}) {
  const [geminiEnv, setGeminiEnvState] = useState("");
  const [geminiConfig, setGeminiConfigState] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiBaseUrl, setGeminiBaseUrl] = useState("");
  const [geminiModel, setGeminiModel] = useState("");
  const [envError, setEnvError] = useState("");
  const [configError, setConfigError] = useState("");

  const envObjToString = useCallback(
    (envObj: Record<string, unknown>): string => {
      const priorityKeys = [
        "GOOGLE_GEMINI_BASE_URL",
        "GEMINI_API_KEY",
        "GEMINI_MODEL",
      ];
      const lines: string[] = [];
      const addedKeys = new Set<string>();

      for (const key of priorityKeys) {
        if (typeof envObj[key] === "string" && envObj[key]) {
          lines.push(`${key}=${envObj[key]}`);
          addedKeys.add(key);
        }
      }

      for (const [key, value] of Object.entries(envObj)) {
        if (!addedKeys.has(key) && typeof value === "string") {
          lines.push(`${key}=${value}`);
        }
      }

      return lines.join("\n");
    },
    [],
  );

  const envStringToObj = useCallback(
    (envString: string): Record<string, string> => {
      const env: Record<string, string> = {};
      const lines = envString.split("\n");
      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const equalIndex = trimmed.indexOf("=");
        if (equalIndex > 0) {
          const key = trimmed.substring(0, equalIndex).trim();
          const value = trimmed.substring(equalIndex + 1).trim();
          env[key] = value;
        }
      });
      return env;
    },
    [],
  );

  // Initialize from initialData if provided (edit mode)
  useState(() => {
    if (!initialData) return;
    const config = initialData.settingsConfig;
    if (typeof config === "object" && config !== null) {
      const env = (config as Record<string, unknown>).env || {};
      const envStr = envObjToString(env as Record<string, unknown>);
      setGeminiEnvState(envStr);

      const configObj = (config as Record<string, unknown>).config || {};
      setGeminiConfigState(JSON.stringify(configObj, null, 2));

      if (typeof (env as Record<string, unknown>).GEMINI_API_KEY === "string") {
        setGeminiApiKey(
          (env as Record<string, unknown>).GEMINI_API_KEY as string,
        );
      }
      if (
        typeof (env as Record<string, unknown>).GOOGLE_GEMINI_BASE_URL ===
        "string"
      ) {
        setGeminiBaseUrl(
          (env as Record<string, unknown>).GOOGLE_GEMINI_BASE_URL as string,
        );
      }
      if (typeof (env as Record<string, unknown>).GEMINI_MODEL === "string") {
        setGeminiModel(
          (env as Record<string, unknown>).GEMINI_MODEL as string,
        );
      }
    }
  });

  const validateGeminiConfig = useCallback((value: string): string => {
    if (!value.trim()) return "";
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return "";
      }
      return "Config must be a JSON object";
    } catch {
      return "Invalid JSON format";
    }
  }, []);

  const setGeminiEnv = useCallback((value: string) => {
    setGeminiEnvState(value);
    setEnvError("");
  }, []);

  const setGeminiConfig = useCallback(
    (value: string | ((prev: string) => string)) => {
      const newValue =
        typeof value === "function" ? value(geminiConfig) : value;
      setGeminiConfigState(newValue);
      setConfigError(validateGeminiConfig(newValue));
    },
    [geminiConfig, validateGeminiConfig],
  );

  const handleGeminiApiKeyChange = useCallback(
    (key: string) => {
      const trimmed = key.trim();
      setGeminiApiKey(trimmed);

      const envObj = envStringToObj(geminiEnv);
      envObj.GEMINI_API_KEY = trimmed;
      const newEnv = envObjToString(envObj);
      setGeminiEnv(newEnv);
    },
    [geminiEnv, envStringToObj, envObjToString, setGeminiEnv],
  );

  const handleGeminiBaseUrlChange = useCallback(
    (url: string) => {
      const sanitized = url.trim().replace(/\/+$/, "");
      setGeminiBaseUrl(sanitized);

      const envObj = envStringToObj(geminiEnv);
      envObj.GOOGLE_GEMINI_BASE_URL = sanitized;
      const newEnv = envObjToString(envObj);
      setGeminiEnv(newEnv);
    },
    [geminiEnv, envStringToObj, envObjToString, setGeminiEnv],
  );

  const handleGeminiModelChange = useCallback(
    (model: string) => {
      const trimmed = model.trim();
      setGeminiModel(trimmed);

      const envObj = envStringToObj(geminiEnv);
      envObj.GEMINI_MODEL = trimmed;
      const newEnv = envObjToString(envObj);
      setGeminiEnv(newEnv);
    },
    [geminiEnv, envStringToObj, envObjToString, setGeminiEnv],
  );

  const handleGeminiEnvChange = useCallback(
    (value: string) => {
      setGeminiEnv(value);
    },
    [setGeminiEnv],
  );

  const handleGeminiConfigChange = useCallback(
    (value: string) => {
      setGeminiConfig(value);
    },
    [setGeminiConfig],
  );

  const resetGeminiConfig = useCallback(
    (env: Record<string, unknown>, config: Record<string, unknown>) => {
      const envString = envObjToString(env);
      const configString = JSON.stringify(config, null, 2);

      setGeminiEnv(envString);
      setGeminiConfig(configString);

      if (typeof env.GEMINI_API_KEY === "string") {
        setGeminiApiKey(env.GEMINI_API_KEY);
      } else {
        setGeminiApiKey("");
      }

      if (typeof env.GOOGLE_GEMINI_BASE_URL === "string") {
        setGeminiBaseUrl(env.GOOGLE_GEMINI_BASE_URL);
      } else {
        setGeminiBaseUrl("");
      }

      if (typeof env.GEMINI_MODEL === "string") {
        setGeminiModel(env.GEMINI_MODEL);
      } else {
        setGeminiModel("");
      }
    },
    [envObjToString, setGeminiEnv, setGeminiConfig],
  );

  return {
    geminiEnv,
    geminiConfig,
    geminiApiKey,
    geminiBaseUrl,
    geminiModel,
    envError,
    configError,
    setGeminiEnv,
    setGeminiConfig,
    handleGeminiApiKeyChange,
    handleGeminiBaseUrlChange,
    handleGeminiModelChange,
    handleGeminiEnvChange,
    handleGeminiConfigChange,
    resetGeminiConfig,
    envStringToObj,
    envObjToString,
  };
}
