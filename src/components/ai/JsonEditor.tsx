import React, { useCallback, useRef } from "react";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { formatJSON } from "./lib/formatters";

interface JsonEditorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  darkMode?: boolean;
  rows?: number;
  showValidation?: boolean;
  language?: "json" | "javascript";
  height?: string | number;
  showMinimap?: boolean;
}

const JsonEditor: React.FC<JsonEditorProps> = ({
  value,
  onChange,
  placeholder: placeholderText = "",
  rows = 12,
  showValidation = true,
  language = "json",
  height,
}) => {
  const { t } = useTranslation('ai');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const heightValue = height
    ? typeof height === "number"
      ? `${height}px`
      : height
    : undefined;

  const minRows = Math.max(4, rows);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const handleFormat = useCallback(() => {
    if (!value.trim()) return;

    try {
      const formatted = formatJSON(value);
      onChange(formatted);
      toast.success(t("common.formatSuccess", { defaultValue: "格式化成功" }), {
        closeButton: true,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toast.error(
        t("common.formatError", {
          defaultValue: "格式化失败：{{error}}",
          error: errorMessage,
        }),
      );
    }
  }, [value, onChange, t]);

  const isFullHeight = height === "100%";

  // Simple JSON validation display
  let validationError = "";
  if (showValidation && language === "json" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        validationError = t("jsonEditor.mustBeObject", {
          defaultValue: "Must be a JSON object",
        });
      }
    } catch (e) {
      validationError =
        e instanceof SyntaxError
          ? e.message
          : t("jsonEditor.invalidJson", { defaultValue: "Invalid JSON" });
    }
  }

  return (
    <div
      style={{ width: "100%", height: isFullHeight ? "100%" : "auto" }}
      className={isFullHeight ? "flex flex-col" : ""}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        placeholder={placeholderText}
        rows={isFullHeight ? undefined : minRows}
        className={[
          "w-full rounded-lg border border-[hsl(var(--border))] bg-transparent text-[hsl(var(--foreground))]",
          "font-mono text-sm leading-relaxed p-3 resize-none",
          "focus:outline-none focus:border-[hsl(var(--primary))]",
          "transition-colors placeholder:text-[hsl(var(--muted-foreground))]",
          isFullHeight ? "flex-1 min-h-0" : "",
          validationError ? "border-red-500 dark:border-red-400" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={
          heightValue
            ? { height: heightValue }
            : isFullHeight
              ? { height: "100%" }
              : { minHeight: `${minRows * 20}px` }
        }
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
      />
      {validationError && (
        <p className="mt-1 text-xs text-red-500 dark:text-red-400">
          {validationError}
        </p>
      )}
      {language === "json" && (
        <button
          type="button"
          onClick={handleFormat}
          className={`${isFullHeight ? "mt-2 flex-shrink-0" : "mt-2"} inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors`}
        >
          <Wand2 className="w-3.5 h-3.5" />
          {t("common.format", { defaultValue: "格式化" })}
        </button>
      )}
    </div>
  );
};

export default JsonEditor;
