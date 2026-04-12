import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { FullScreenPanel } from "./FullScreenPanel";
import type { AiProvider, AppId } from "../lib/api";
import {
  ProviderForm,
  type ProviderFormValues,
} from "./forms/ProviderForm";
import { providerPresets } from "../config/claudeProviderPresets";
import { codexProviderPresets } from "../config/codexProviderPresets";
import { geminiProviderPresets } from "../config/geminiProviderPresets";
import { extractCodexBaseUrl } from "../lib/providerConfigUtils";
import type { OpenClawSuggestedDefaults } from "../config/openclawProviderPresets";

interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appId: AppId;
  onSubmit: (
    provider: Omit<AiProvider, "id"> & {
      providerKey?: string;
      suggestedDefaults?: OpenClawSuggestedDefaults;
    },
  ) => Promise<void> | void;
}

export function AddProviderDialog({
  open,
  onOpenChange,
  appId,
  onSubmit,
}: AddProviderDialogProps) {
  const { t } = useTranslation('ai');
  const [isFormSubmitting, setIsFormSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (values: ProviderFormValues) => {
      let parsedConfig: Record<string, unknown>;
      try {
        parsedConfig = JSON.parse(values.settingsConfig) as Record<
          string,
          unknown
        >;
      } catch {
        parsedConfig = {};
      }

      const providerData: Omit<AiProvider, "id"> & {
        providerKey?: string;
        suggestedDefaults?: OpenClawSuggestedDefaults;
      } = {
        name: values.name.trim(),
        notes: values.notes?.trim() || undefined,
        websiteUrl: values.websiteUrl?.trim() || undefined,
        settingsConfig: parsedConfig,
        icon: values.icon?.trim() || undefined,
        iconColor: values.iconColor?.trim() || undefined,
        providerType: (values.meta?.providerType as string) || "",
        baseUrl: "",
        apiKey: "",
        apps: {
          claude: appId === "claude",
          codex: appId === "codex",
          gemini: appId === "gemini",
          opencode: appId === "opencode",
          openclaw: appId === "openclaw",
        },
        models: {},
        enabled: true,
        category: values.presetCategory || undefined,
        meta: values.meta,
        isPartner: values.isPartner,
      };

      // OpenCode/OpenClaw: pass providerKey for ID generation
      if (
        (appId === "opencode" || appId === "openclaw") &&
        values.providerKey
      ) {
        providerData.providerKey = values.providerKey;
      }

      const hasCustomEndpoints =
        providerData.meta?.custom_endpoints &&
        Object.keys(providerData.meta.custom_endpoints).length > 0;

      if (!hasCustomEndpoints && values.presetCategory !== "omo") {
        const urlSet = new Set<string>();

        const addUrl = (rawUrl?: string) => {
          const url = (rawUrl || "").trim().replace(/\/+$/, "");
          if (url && url.startsWith("http")) {
            urlSet.add(url);
          }
        };

        if (values.presetId) {
          if (appId === "claude") {
            const presets = providerPresets;
            const presetIndex = parseInt(
              values.presetId.replace("claude-", ""),
            );
            if (
              !isNaN(presetIndex) &&
              presetIndex >= 0 &&
              presetIndex < presets.length
            ) {
              const preset = presets[presetIndex];
              if (preset?.endpointCandidates) {
                preset.endpointCandidates.forEach(addUrl);
              }
            }
          } else if (appId === "codex") {
            const presets = codexProviderPresets;
            const presetIndex = parseInt(values.presetId.replace("codex-", ""));
            if (
              !isNaN(presetIndex) &&
              presetIndex >= 0 &&
              presetIndex < presets.length
            ) {
              const preset = presets[presetIndex];
              if (Array.isArray(preset.endpointCandidates)) {
                preset.endpointCandidates.forEach(addUrl);
              }
            }
          } else if (appId === "gemini") {
            const presets = geminiProviderPresets;
            const presetIndex = parseInt(
              values.presetId.replace("gemini-", ""),
            );
            if (
              !isNaN(presetIndex) &&
              presetIndex >= 0 &&
              presetIndex < presets.length
            ) {
              const preset = presets[presetIndex];
              if (Array.isArray(preset.endpointCandidates)) {
                preset.endpointCandidates.forEach(addUrl);
              }
            }
          }
        }

        if (appId === "claude") {
          const env = parsedConfig.env as Record<string, unknown> | undefined;
          if (env?.ANTHROPIC_BASE_URL) {
            addUrl(env.ANTHROPIC_BASE_URL as string);
          }
        } else if (appId === "codex") {
          const config = parsedConfig.config as string | undefined;
          if (config) {
            const extractedBaseUrl = extractCodexBaseUrl(config);
            if (extractedBaseUrl) {
              addUrl(extractedBaseUrl);
            }
          }
        } else if (appId === "gemini") {
          const env = parsedConfig.env as Record<string, unknown> | undefined;
          if (env?.GOOGLE_GEMINI_BASE_URL) {
            addUrl(env.GOOGLE_GEMINI_BASE_URL as string);
          }
        } else if (appId === "opencode") {
          const options = parsedConfig.options as
            | Record<string, unknown>
            | undefined;
          if (options?.baseURL) {
            addUrl(options.baseURL as string);
          }
        } else if (appId === "openclaw") {
          if (parsedConfig.baseUrl) {
            addUrl(parsedConfig.baseUrl as string);
          }
        }

        const urls = Array.from(urlSet);
        if (urls.length > 0) {
          const now = Date.now();
          const customEndpoints: Record<string, { url: string; addedAt: number; lastUsed?: number }> = {};
          urls.forEach((url) => {
            customEndpoints[url] = {
              url,
              addedAt: now,
              lastUsed: undefined,
            };
          });

          providerData.meta = {
            ...(providerData.meta ?? {}),
            custom_endpoints: customEndpoints,
          };
        }
      }

      // OpenClaw: pass suggestedDefaults for model registration
      if (appId === "openclaw" && values.suggestedDefaults) {
        providerData.suggestedDefaults = values.suggestedDefaults;
      }

      try {
        await onSubmit(providerData);
        onOpenChange(false);
      } catch (err) {
        console.error("[AddProviderDialog] submit failed", err);
        toast.error(
          t("provider.addFailed", { defaultValue: "供应商添加失败" }),
        );
      }
    },
    [appId, onSubmit, onOpenChange, t],
  );

  const footer = (
    <>
      <Button
        variant="outline"
        onClick={() => onOpenChange(false)}
        className="border-border/20 hover:bg-accent hover:text-accent-foreground"
      >
        {t("common.cancel", { defaultValue: "取消" })}
      </Button>
      <Button
        type="submit"
        form="provider-form"
        disabled={isFormSubmitting}
        className="bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="h-4 w-4 mr-2" />
        {t("common.add", { defaultValue: "添加" })}
      </Button>
    </>
  );

  return (
    <FullScreenPanel
      isOpen={open}
      title={t("provider.addNewProvider", { defaultValue: "添加供应商" })}
      onClose={() => onOpenChange(false)}
      footer={footer}
    >
      <ProviderForm
        appId={appId}
        submitLabel={t("common.add", { defaultValue: "添加" })}
        onSubmit={handleSubmit}
        onCancel={() => onOpenChange(false)}
        onSubmittingChange={setIsFormSubmitting}
        showButtons={false}
      />
    </FullScreenPanel>
  );
}
