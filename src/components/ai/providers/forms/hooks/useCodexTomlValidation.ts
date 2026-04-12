import { useState, useCallback } from "react";
import TOML from "smol-toml";
import { useEffect, useRef } from "react";

/**
 * Codex config.toml 格式校验 Hook
 */
export function useCodexTomlValidation() {
  const [configError, setConfigError] = useState("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const validateToml = useCallback((tomlText: string): boolean => {
    if (!tomlText.trim()) {
      setConfigError("");
      return true;
    }

    try {
      TOML.parse(tomlText);
      setConfigError("");
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "TOML 格式错误";
      setConfigError(errorMessage);
      return false;
    }
  }, []);

  const debouncedValidate = useCallback(
    (tomlText: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        validateToml(tomlText);
      }, 500);
    },
    [validateToml],
  );

  const clearError = useCallback(() => {
    setConfigError("");
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    configError,
    validateToml,
    debouncedValidate,
    clearError,
  };
}
