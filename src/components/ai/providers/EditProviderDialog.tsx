import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";
import { Button } from "../ui/button";
import { FullScreenPanel } from "./FullScreenPanel";
import type { AiProvider, AppId } from "../lib/api";
import {
  ProviderForm,
  type ProviderFormValues,
} from "./forms/ProviderForm";

interface EditProviderDialogProps {
  open: boolean;
  provider: AiProvider | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    provider: AiProvider;
    originalId?: string;
  }) => Promise<void> | void;
  appId: AppId;
}

export function EditProviderDialog({
  open,
  provider,
  onOpenChange,
  onSubmit,
  appId,
}: EditProviderDialogProps) {
  const { t } = useTranslation('ai');
  const [isFormSubmitting, setIsFormSubmitting] = useState(false);

  // GWShell: no live-settings API (vscodeApi unavailable), always use DB config.
  // OpenClaw live provider loading is not implemented either — use stored config.
  const initialSettingsConfig = useMemo(() => {
    return (provider?.settingsConfig ?? {}) as Record<string, unknown>;
  }, [provider?.settingsConfig]);

  const initialData = useMemo(() => {
    if (!provider) return null;
    return {
      name: provider.name,
      notes: provider.notes,
      websiteUrl: provider.websiteUrl,
      settingsConfig: initialSettingsConfig,
      category: provider.category as any,
      meta: provider.meta,
      icon: provider.icon,
      iconColor: provider.iconColor,
    };
  }, [
    open,
    provider?.id,
    provider?.meta,
    initialSettingsConfig,
  ]);

  const handleSubmit = useCallback(
    async (values: ProviderFormValues) => {
      if (!provider) return;

      let parsedConfig: Record<string, unknown>;
      try {
        parsedConfig = JSON.parse(values.settingsConfig) as Record<
          string,
          unknown
        >;
      } catch {
        parsedConfig = provider.settingsConfig ?? {};
      }

      const nextProviderId =
        (appId === "opencode" || appId === "openclaw") &&
        values.providerKey?.trim()
          ? values.providerKey.trim()
          : provider.id;

      const updatedProvider: AiProvider = {
        ...provider,
        id: nextProviderId,
        name: values.name.trim(),
        notes: values.notes?.trim() || undefined,
        websiteUrl: values.websiteUrl?.trim() || undefined,
        settingsConfig: parsedConfig,
        icon: values.icon?.trim() || undefined,
        iconColor: values.iconColor?.trim() || undefined,
        category: values.presetCategory ?? provider.category,
        meta: values.meta ?? provider.meta,
      };

      await onSubmit({
        provider: updatedProvider,
        originalId: provider.id,
      });
      onOpenChange(false);
    },
    [appId, onSubmit, onOpenChange, provider],
  );

  if (!provider || !initialData) {
    return null;
  }

  return (
    <FullScreenPanel
      isOpen={open}
      title={t("provider.editProvider", { defaultValue: "编辑供应商" })}
      onClose={() => onOpenChange(false)}
      footer={
        <Button
          type="submit"
          form="provider-form"
          disabled={isFormSubmitting}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Save className="h-4 w-4 mr-2" />
          {t("common.save", { defaultValue: "保存" })}
        </Button>
      }
    >
      <ProviderForm
        appId={appId}
        providerId={provider.id}
        submitLabel={t("common.save", { defaultValue: "保存" })}
        onSubmit={handleSubmit}
        onCancel={() => onOpenChange(false)}
        onSubmittingChange={setIsFormSubmitting}
        initialData={initialData}
        showButtons={false}
      />
    </FullScreenPanel>
  );
}
