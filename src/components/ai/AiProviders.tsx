/**
 * AiProviders - Main AI provider management component
 *
 * Composes: AppSwitcher, ProviderList, AddProviderDialog, EditProviderDialog
 * Manages: provider CRUD, active provider switching, per-app selection
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "./ui/button";
import { AppSwitcher } from "./providers/AppSwitcher";
import { ProviderList } from "./providers/ProviderList";
import { AddProviderDialog } from "./providers/AddProviderDialog";
import { EditProviderDialog } from "./providers/EditProviderDialog";
import { providersApi, activeIdsToRecord, type AiProvider, type AppId } from "./lib/api";
import { ConfirmDialog } from "./ConfirmDialog";

const STORAGE_KEY = "gwshell-ai-last-app";

const getInitialApp = (): AppId => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as AppId | null;
    if (saved && ["claude", "codex", "gemini", "opencode", "openclaw"].includes(saved)) {
      return saved;
    }
  } catch {}
  return "claude";
};

export function AiProviders() {
  const { t } = useTranslation('ai');

  const [activeApp, setActiveApp] = useState<AppId>(getInitialApp);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [activeIds, setActiveIds] = useState<Record<AppId, string | undefined>>({
    claude: undefined,
    codex: undefined,
    gemini: undefined,
    opencode: undefined,
    openclaw: undefined,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editProvider, setEditProvider] = useState<AiProvider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiProvider | null>(null);

  const loadProviders = useCallback(async () => {
    try {
      const [all, ids] = await Promise.all([
        providersApi.list(),
        providersApi.getActiveIds(),
      ]);
      setProviders(all);
      setActiveIds(activeIdsToRecord(ids));
    } catch (err) {
      console.error("[AiProviders] load failed", err);
      toast.error(t("provider.loadFailed", { defaultValue: "加载供应商失败" }));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const appProviders = useMemo(() => {
    return providers.filter((p) => p.apps[activeApp]);
  }, [providers, activeApp]);

  const currentProviderId = activeIds[activeApp] ?? "";

  const handleSwitch = useCallback(
    async (provider: AiProvider) => {
      try {
        await providersApi.switch(provider.id, activeApp);
        setActiveIds((prev) => ({ ...prev, [activeApp]: provider.id }));
        toast.success(
          t("provider.switchSuccess", {
            name: provider.name,
            defaultValue: `已切换到 ${provider.name}`,
          }),
        );
      } catch (err) {
        console.error("[AiProviders] switch failed", err);
        toast.error(
          t("provider.switchFailed", { defaultValue: "切换供应商失败" }),
        );
      }
    },
    [activeApp, t],
  );

  const handleAdd = useCallback(
    async (
      providerData: Omit<AiProvider, "id"> & { providerKey?: string },
    ) => {
      try {
        // Generate a unique ID
        const baseId = providerData.providerKey?.trim() || crypto.randomUUID().slice(0, 8);
        const baseApps: AiProvider["apps"] = Object.assign(
          { claude: false, codex: false, gemini: false, opencode: false, openclaw: false },
          providerData.apps,
          { [activeApp]: true },
        );
        const newProvider: AiProvider = {
          ...providerData,
          id: baseId,
          apps: baseApps,
        };
        await providersApi.save(newProvider);
        await loadProviders();
        toast.success(
          t("provider.addSuccess", { defaultValue: "供应商添加成功" }),
        );
      } catch (err) {
        console.error("[AiProviders] add failed", err);
        throw err; // Let dialog handle toast
      }
    },
    [activeApp, loadProviders, t],
  );

  const handleEdit = useCallback(
    async (payload: { provider: AiProvider; originalId?: string }) => {
      try {
        // If ID changed (opencode/openclaw provider key change), delete old then save new
        if (payload.originalId && payload.originalId !== payload.provider.id) {
          await providersApi.delete(payload.originalId);
        }
        await providersApi.save(payload.provider);
        await loadProviders();
        toast.success(
          t("provider.saveSuccess", { defaultValue: "供应商保存成功" }),
        );
      } catch (err) {
        console.error("[AiProviders] edit failed", err);
        toast.error(
          t("provider.saveFailed", { defaultValue: "供应商保存失败" }),
        );
      }
    },
    [loadProviders, t],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await providersApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      await loadProviders();
      toast.success(
        t("provider.deleteSuccess", { defaultValue: "供应商已删除" }),
      );
    } catch (err) {
      console.error("[AiProviders] delete failed", err);
      toast.error(
        t("provider.deleteFailed", { defaultValue: "删除供应商失败" }),
      );
    }
  }, [deleteTarget, loadProviders, t]);

  const handleDuplicate = useCallback(
    async (provider: AiProvider) => {
      try {
        const copy: AiProvider = {
          ...provider,
          id: crypto.randomUUID().slice(0, 8),
          name: `${provider.name} (Copy)`,
          createdAt: Date.now(),
        };
        await providersApi.save(copy);
        await loadProviders();
        toast.success(
          t("provider.duplicateSuccess", { defaultValue: "供应商已复制" }),
        );
      } catch (err) {
        console.error("[AiProviders] duplicate failed", err);
        toast.error(
          t("provider.duplicateFailed", { defaultValue: "复制供应商失败" }),
        );
      }
    },
    [loadProviders, t],
  );

  const handleOpenWebsite = useCallback((url: string) => {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  return (
    <div className="flex flex-col h-full ai-scope">
      {/* App switcher */}
      <div className="px-4 pt-3 pb-2 border-b border-border/20">
        <AppSwitcher
          activeApp={activeApp}
          onSwitch={(app: AppId) => {
            localStorage.setItem(STORAGE_KEY, app);
            setActiveApp(app);
          }}
        />
      </div>

      {/* Provider list */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ProviderList
          providers={appProviders}
          currentProviderId={currentProviderId}
          appId={activeApp}
          onSwitch={handleSwitch}
          onEdit={(p: AiProvider) => setEditProvider(p)}
          onDelete={(p: AiProvider) => setDeleteTarget(p)}
          onDuplicate={handleDuplicate}
          onOpenWebsite={handleOpenWebsite}
          onCreate={() => setAddOpen(true)}
          isLoading={isLoading}
        />
      </div>

      {/* Add button (bottom bar) */}
      <div className="px-4 py-3 border-t border-border/20 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {appProviders.length}{" "}
          {t("provider.countSuffix", { defaultValue: "个供应商" })}
        </span>
        <Button
          size="sm"
          onClick={() => setAddOpen(true)}
          className="h-8 gap-1"
        >
          <Plus className="h-4 w-4" />
          {t("common.add", { defaultValue: "添加" })}
        </Button>
      </div>

      {/* Add dialog */}
      <AddProviderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        appId={activeApp}
        onSubmit={handleAdd}
      />

      {/* Edit dialog */}
      <EditProviderDialog
        open={editProvider !== null}
        provider={editProvider}
        onOpenChange={(open: boolean) => {
          if (!open) setEditProvider(null);
        }}
        onSubmit={handleEdit}
        appId={activeApp}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t("provider.deleteConfirmTitle", { defaultValue: "删除供应商" })}
        message={t("provider.deleteConfirmDesc", {
          name: deleteTarget?.name ?? "",
          defaultValue: `确定要删除供应商 "${deleteTarget?.name ?? ""}" 吗？此操作不可撤销。`,
        })}
        confirmText={t("common.delete", { defaultValue: "删除" })}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="destructive"
      />
    </div>
  );
}

export default AiProviders;
