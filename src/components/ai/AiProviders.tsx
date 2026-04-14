// src/components/ai/AiProviders.tsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { ProviderList } from './providers/ProviderList';
import { AddProviderDialog } from './providers/AddProviderDialog';
import { EditProviderDialog } from './providers/EditProviderDialog';
import { providersApi, activeIdsToRecord, type AiProvider, type AppId } from './lib/api';
import { ConfirmDialog } from './ConfirmDialog';

interface ProviderHealthDto {
  providerId: string;
  status: string;
  latencyMs?: number;
  httpStatus?: number;
  checkMode: string;
  target: string;
  message: string;
  checkedAt: number;
}

interface AiProvidersProps {
  activeApp: AppId;
  onActiveAppChange: (app: AppId) => void;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}

export function AiProviders({
  activeApp,
  onActiveAppChange: _onActiveAppChange,
  addOpen,
  onAddOpenChange,
}: AiProvidersProps) {
  const { t } = useTranslation('ai');

  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [activeIds, setActiveIds] = useState<Record<AppId, string | undefined>>({
    claude: undefined,
    codex: undefined,
    gemini: undefined,
    opencode: undefined,
    openclaw: undefined,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [editProvider, setEditProvider] = useState<AiProvider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiProvider | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [healthResults, setHealthResults] = useState<Record<string, ProviderHealthDto>>({});

  const loadProviders = useCallback(async () => {
    try {
      const [all, ids] = await Promise.all([
        providersApi.list(),
        providersApi.getActiveIds(),
      ]);
      setProviders(all);
      setActiveIds(activeIdsToRecord(ids));
    } catch (err) {
      console.error('[AiProviders] load failed', err);
      toast.error(t('provider.loadFailed', { defaultValue: '加载供应商失败' }));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const appProviders = useMemo(
    () => providers.filter((p) => p.apps[activeApp]),
    [providers, activeApp],
  );

  const currentProviderId = activeIds[activeApp] ?? '';

  const handleSwitch = useCallback(
    async (provider: AiProvider) => {
      try {
        await providersApi.switch(provider.id, activeApp);
        setActiveIds((prev) => ({ ...prev, [activeApp]: provider.id }));
        toast.success(
          t('provider.switchSuccess', {
            name: provider.name,
            defaultValue: `已切换到 ${provider.name}`,
          }),
        );
      } catch (err) {
        console.error('[AiProviders] switch failed', err);
        toast.error(t('provider.switchFailed', { defaultValue: '切换供应商失败' }));
      }
    },
    [activeApp, t],
  );

  const handleAdd = useCallback(
    async (providerData: Omit<AiProvider, 'id'> & { providerKey?: string }) => {
      try {
        const baseId = providerData.providerKey?.trim() || crypto.randomUUID().slice(0, 8);
        const baseApps: AiProvider['apps'] = Object.assign(
          { claude: false, codex: false, gemini: false, opencode: false, openclaw: false },
          providerData.apps,
          { [activeApp]: true },
        );
        const newProvider: AiProvider = { ...providerData, id: baseId, apps: baseApps };
        await providersApi.save(newProvider);
        await loadProviders();
        toast.success(t('provider.addSuccess', { defaultValue: '供应商添加成功' }));
      } catch (err) {
        console.error('[AiProviders] add failed', err);
        throw err;
      }
    },
    [activeApp, loadProviders, t],
  );

  const handleEdit = useCallback(
    async (payload: { provider: AiProvider; originalId?: string }) => {
      try {
        if (payload.originalId && payload.originalId !== payload.provider.id) {
          await providersApi.delete(payload.originalId);
        }
        await providersApi.save(payload.provider);
        await loadProviders();
        toast.success(t('provider.saveSuccess', { defaultValue: '供应商保存成功' }));
      } catch (err) {
        console.error('[AiProviders] edit failed', err);
        toast.error(t('provider.saveFailed', { defaultValue: '供应商保存失败' }));
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
      toast.success(t('provider.deleteSuccess', { defaultValue: '供应商已删除' }));
    } catch (err) {
      console.error('[AiProviders] delete failed', err);
      toast.error(t('provider.deleteFailed', { defaultValue: '删除供应商失败' }));
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
        toast.success(t('provider.duplicateSuccess', { defaultValue: '供应商已复制' }));
      } catch (err) {
        console.error('[AiProviders] duplicate failed', err);
        toast.error(t('provider.duplicateFailed', { defaultValue: '复制供应商失败' }));
      }
    },
    [loadProviders, t],
  );

  const handleTest = useCallback(
    async (provider: AiProvider) => {
      if (testingId) return;
      setTestingId(provider.id);
      try {
        const result = await invoke<ProviderHealthDto>('ai_platform_check_provider_health', {
          providerId: provider.id,
        });
        setHealthResults((prev) => ({ ...prev, [provider.id]: result }));
        if (result.status === 'ok') {
          toast.success(
            t('provider.testOk', {
              name: provider.name,
              ms: result.latencyMs ?? 0,
              defaultValue: `${provider.name} 响应正常 (${result.latencyMs ?? 0}ms)`,
            }),
            { closeButton: true },
          );
        } else {
          toast.error(
            t('provider.testFail', {
              name: provider.name,
              msg: result.message,
              defaultValue: `${provider.name} 测试失败: ${result.message}`,
            }),
          );
        }
      } catch (err) {
        toast.error(String(err));
      } finally {
        setTestingId(null);
      }
    },
    [testingId, t],
  );

  const handleOpenWebsite = useCallback((url: string) => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <div className="flex flex-col h-full ai-scope">
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
          onCreate={() => onAddOpenChange(true)}
          onTest={handleTest}
          isLoading={isLoading}
          testingProviderId={testingId ?? undefined}
          healthResults={healthResults}
        />
      </div>

      <AddProviderDialog
        open={addOpen}
        onOpenChange={onAddOpenChange}
        appId={activeApp}
        onSubmit={handleAdd}
      />

      <EditProviderDialog
        open={editProvider !== null}
        provider={editProvider}
        onOpenChange={(open: boolean) => { if (!open) setEditProvider(null); }}
        onSubmit={handleEdit}
        appId={activeApp}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t('provider.deleteConfirmTitle', { defaultValue: '删除供应商' })}
        message={t('provider.deleteConfirmDesc', {
          name: deleteTarget?.name ?? '',
          defaultValue: `确定要删除供应商 "${deleteTarget?.name ?? ''}" 吗？此操作不可撤销。`,
        })}
        confirmText={t('common.delete', { defaultValue: '删除' })}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="destructive"
      />
    </div>
  );
}

export default AiProviders;
