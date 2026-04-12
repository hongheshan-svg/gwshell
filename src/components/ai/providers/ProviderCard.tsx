import { useMemo } from "react";
import { GripVertical } from "lucide-react";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import type { AiProvider, AppId } from "../lib/api";
import { cn } from "../lib/utils";
import { ProviderActions } from "./ProviderActions";
import { ProviderIcon } from "./ProviderIcon";

interface DragHandleProps {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  isDragging: boolean;
}

interface ProviderCardProps {
  provider: AiProvider;
  isCurrent: boolean;
  appId: AppId;
  isInConfig?: boolean;
  onSwitch: (provider: AiProvider) => void;
  onEdit: (provider: AiProvider) => void;
  onDelete: (provider: AiProvider) => void;
  onRemoveFromConfig?: (provider: AiProvider) => void;
  onConfigureUsage: (provider: AiProvider) => void;
  onOpenWebsite: (url: string) => void;
  onDuplicate: (provider: AiProvider) => void;
  onTest?: (provider: AiProvider) => void;
  onOpenTerminal?: (provider: AiProvider) => void;
  isTesting?: boolean;
  isProxyRunning: boolean;
  isProxyTakeover?: boolean;
  dragHandleProps?: DragHandleProps;
}

/** Inline base URL extractor for Codex config (replaces providerConfigUtils) */
function extractCodexBaseUrl(configStr: string): string | undefined {
  const match = configStr.match(/base_url\s*=\s*"([^"]+)"/);
  return match?.[1];
}

const extractApiUrl = (provider: AiProvider, fallbackText: string): string => {
  if (provider.notes?.trim()) {
    return provider.notes.trim();
  }

  if (provider.websiteUrl) {
    return provider.websiteUrl;
  }

  const config = provider.settingsConfig;

  if (config && typeof config === "object") {
    const envBase =
      (config as Record<string, any>)?.env?.ANTHROPIC_BASE_URL ||
      (config as Record<string, any>)?.env?.GOOGLE_GEMINI_BASE_URL;
    if (typeof envBase === "string" && envBase.trim()) {
      return envBase;
    }

    const configStr = (config as Record<string, any>)?.config;
    if (typeof configStr === "string" && configStr.includes("base_url")) {
      const extracted = extractCodexBaseUrl(configStr);
      if (extracted) {
        return extracted;
      }
    }
  }

  // Also check top-level baseUrl
  if (provider.baseUrl?.trim()) {
    return provider.baseUrl.trim();
  }

  return fallbackText;
};

export function ProviderCard({
  provider,
  isCurrent,
  appId,
  isInConfig = true,
  onSwitch,
  onEdit,
  onDelete,
  onRemoveFromConfig,
  onConfigureUsage,
  onOpenWebsite,
  onDuplicate,
  onTest,
  onOpenTerminal,
  isTesting,
  isProxyRunning: _isProxyRunning,
  isProxyTakeover = false,
  dragHandleProps,
}: ProviderCardProps) {
  const fallbackUrlText = "Not configured";

  const displayUrl = useMemo(() => {
    return extractApiUrl(provider, fallbackUrlText);
  }, [provider]);

  const isClickableUrl = useMemo(() => {
    if (provider.notes?.trim()) {
      return false;
    }
    if (displayUrl === fallbackUrlText) {
      return false;
    }
    return true;
  }, [provider.notes, displayUrl]);

  const handleOpenWebsite = () => {
    if (!isClickableUrl) return;
    onOpenWebsite(displayUrl);
  };

  const isAdditiveMode = appId === "opencode" || appId === "openclaw";

  // Active: for additive-mode, treat "isInConfig" as the highlight signal
  const isActiveProvider = isAdditiveMode ? isInConfig : isCurrent;

  const shouldUseGreen = !isAdditiveMode && isProxyTakeover && isActiveProvider;
  const shouldUseBlue =
    !isAdditiveMode && !isProxyTakeover && isActiveProvider;
  const hasPersistentConfigHighlight = isAdditiveMode && isInConfig;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border p-4 transition-all duration-300",
        "bg-card text-card-foreground group",
        isProxyTakeover
          ? "hover:border-emerald-500/50"
          : "hover:border-border-active",
        shouldUseGreen &&
          "border-emerald-500/60 shadow-sm shadow-emerald-500/10",
        (shouldUseBlue || hasPersistentConfigHighlight) &&
          "border-blue-500/60 shadow-sm shadow-blue-500/10",
        !isActiveProvider && !hasPersistentConfigHighlight && "hover:shadow-sm",
        dragHandleProps?.isDragging &&
          "cursor-grabbing border-primary shadow-lg scale-105 z-10",
      )}
    >
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-r to-transparent transition-opacity duration-500 pointer-events-none",
          shouldUseGreen && "from-emerald-500/10",
          (shouldUseBlue || hasPersistentConfigHighlight) && "from-blue-500/10",
          !shouldUseGreen &&
            !shouldUseBlue &&
            !hasPersistentConfigHighlight &&
            "from-primary/10",
          isActiveProvider || hasPersistentConfigHighlight
            ? "opacity-100"
            : "opacity-0",
        )}
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <button
            type="button"
            className={cn(
              "-ml-1.5 flex-shrink-0 cursor-grab active:cursor-grabbing p-1.5",
              "text-muted-foreground/50 hover:text-muted-foreground transition-colors",
              dragHandleProps?.isDragging && "cursor-grabbing",
            )}
            aria-label="Drag to reorder"
            {...(dragHandleProps?.attributes ?? {})}
            {...(dragHandleProps?.listeners ?? {})}
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center border border-border group-hover:scale-105 transition-transform duration-300">
            <ProviderIcon
              icon={provider.icon}
              name={provider.name}
              color={provider.iconColor}
              size={20}
            />
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 min-h-7">
              <h3 className="text-base font-semibold leading-none">
                {provider.name}
              </h3>

              {provider.category === "third_party" && provider.isPartner && (
                <span
                  className="text-yellow-500 dark:text-yellow-400"
                  title="Official partner"
                >
                  ⭐
                </span>
              )}
            </div>

            {displayUrl && (
              <button
                type="button"
                onClick={handleOpenWebsite}
                className={cn(
                  "inline-flex items-center text-sm max-w-[280px]",
                  isClickableUrl
                    ? "text-blue-500 transition-colors hover:underline dark:text-blue-400 cursor-pointer"
                    : "text-muted-foreground cursor-default",
                )}
                title={displayUrl}
                disabled={!isClickableUrl}
              >
                <span className="truncate">{displayUrl}</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center ml-auto min-w-0 gap-3">
          <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100 group-hover:pointer-events-auto group-focus-within:pointer-events-auto transition-opacity duration-200">
            <ProviderActions
              appId={appId}
              isCurrent={isCurrent}
              isInConfig={isInConfig}
              isTesting={isTesting}
              isProxyTakeover={isProxyTakeover}
              onSwitch={() => onSwitch(provider)}
              onEdit={() => onEdit(provider)}
              onDuplicate={() => onDuplicate(provider)}
              onTest={onTest ? () => onTest(provider) : undefined}
              onConfigureUsage={() => onConfigureUsage(provider)}
              onDelete={() => onDelete(provider)}
              onRemoveFromConfig={
                onRemoveFromConfig
                  ? () => onRemoveFromConfig(provider)
                  : undefined
              }
              onOpenTerminal={
                onOpenTerminal ? () => onOpenTerminal(provider) : undefined
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
