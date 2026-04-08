import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  checkAiPlatformProviderHealth,
  deleteAiPlatformProvider,
  type ProviderHealth,
  type ProviderApps,
  type ProviderRecord,
  type ProviderSwitchHistory,
  saveAiPlatformProvider,
  switchAiPlatformProvider,
} from '../../infra/commands/providers';
import { useAiPlatformProviders } from '../../infra/query/useAiPlatformProviders';

type AppFilter = 'all' | keyof ProviderApps;

interface ProviderDraft {
  id?: string;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  notes: string;
  failoverPriority: number;
  apps: ProviderApps;
}

const appOptions: Array<{ id: AppFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'openclaw', label: 'OpenClaw' },
];

function emptyApps(): ProviderApps {
  return {
    claude: false,
    codex: false,
    gemini: false,
    opencode: false,
    openclaw: false,
  };
}

function createEmptyDraft(seedApp: AppFilter): ProviderDraft {
  const apps = emptyApps();
  if (seedApp !== 'all') {
    apps[seedApp] = true;
  }

  return {
    name: '',
    providerType: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    model: '',
    notes: '',
    failoverPriority: seedApp === 'all' ? 50 : 10,
    apps,
  };
}

function getPrimaryModel(provider: ProviderRecord) {
  return (
    provider.models.claude?.model ||
    provider.models.codex?.model ||
    provider.models.gemini?.model ||
    provider.models.opencode?.model ||
    provider.models.openclaw?.model ||
    ''
  );
}

function toDraft(provider: ProviderRecord): ProviderDraft {
  return {
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: getPrimaryModel(provider),
    notes: provider.notes ?? '',
    failoverPriority: provider.failoverPriority ?? 50,
    apps: {
      claude: provider.apps.claude,
      codex: provider.apps.codex,
      gemini: provider.apps.gemini,
      opencode: provider.apps.opencode,
      openclaw: provider.apps.openclaw,
    },
  };
}

function toRecord(draft: ProviderDraft, existing?: ProviderRecord): ProviderRecord {
  const now = Date.now();
  const providerId = draft.id ?? globalThis.crypto.randomUUID();
  const apps = draft.apps;
  const model = draft.model.trim();

  return {
    id: providerId,
    name: draft.name.trim(),
    providerType: draft.providerType.trim() || 'openai-compatible',
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim(),
    apps,
    models: {
      claude: apps.claude ? { model, sonnetModel: model || undefined } : undefined,
      codex: apps.codex ? { model, reasoningEffort: 'high' } : undefined,
      gemini: apps.gemini ? { model } : undefined,
      opencode: apps.opencode ? { model } : undefined,
      openclaw: apps.openclaw ? { model } : undefined,
    },
    enabled: true,
    notes: draft.notes.trim() || undefined,
    websiteUrl: existing?.websiteUrl,
    icon: existing?.icon,
    iconColor: existing?.iconColor,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    failoverPriority: draft.failoverPriority,
  };
}

function providerSupportsFilter(provider: ProviderRecord, filter: AppFilter) {
  if (filter === 'all') {
    return true;
  }
  return provider.apps[filter];
}

function isActiveFor(provider: ProviderRecord, activeId: string | undefined) {
  return activeId === provider.id;
}

function formatTimestamp(timestamp: number | undefined) {
  if (!timestamp) {
    return 'unknown';
  }
  return new Date(timestamp * 1000).toLocaleString();
}

export function ProvidersPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<AppFilter>('all');
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [healthByProvider, setHealthByProvider] = useState<Record<string, ProviderHealth>>({});
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [batchChecking, setBatchChecking] = useState(false);
  const { data, isLoading, error } = useAiPlatformProviders();

  const effectiveHealthByProvider = useMemo(() => {
    const fromSnapshot = Object.fromEntries(
      (data?.healthChecks ?? []).map((health) => [health.providerId, health]),
    );
    return { ...fromSnapshot, ...healthByProvider };
  }, [data?.healthChecks, healthByProvider]);

  const filteredProviders = useMemo(
    () =>
      [...(data?.providers ?? [])]
        .filter((provider) => providerSupportsFilter(provider, filter))
        .sort((left, right) => {
          const leftPriority = left.failoverPriority ?? 999;
          const rightPriority = right.failoverPriority ?? 999;
          if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority;
          }
          return left.name.localeCompare(right.name);
        }),
    [data?.providers, filter],
  );

  const activeEntries = useMemo(
    () =>
      (['claude', 'codex', 'gemini', 'opencode', 'openclaw'] as const).map((app) => {
        const activeId = data?.active[app];
        const provider = data?.providers.find((candidate) => candidate.id === activeId);
        return { app, provider };
      }),
    [data?.active, data?.providers],
  );

  const selectedProvider = useMemo(
    () => filteredProviders.find((provider) => provider.id === selectedProviderId) ?? filteredProviders[0],
    [filteredProviders, selectedProviderId],
  );

  const selectedHealth = selectedProvider ? effectiveHealthByProvider[selectedProvider.id] : undefined;

  const selectedHistory = useMemo(
    () =>
      selectedProvider
        ? (data?.switchHistory ?? []).filter((entry) => entry.providerId === selectedProvider.id).slice(0, 6)
        : [],
    [data?.switchHistory, selectedProvider],
  );

  useEffect(() => {
    if (filteredProviders.length === 0) {
      if (selectedProviderId !== null) {
        setSelectedProviderId(null);
      }
      return;
    }

    if (!selectedProviderId || !filteredProviders.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(filteredProviders[0].id);
    }
  }, [filteredProviders, selectedProviderId]);

  const saveMutation = useMutation({
    mutationFn: saveAiPlatformProvider,
    onSuccess: async () => {
      setMessage('Provider 已保存到新 ai_platform store。');
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'providers'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAiPlatformProvider,
    onSuccess: async () => {
      setMessage('Provider 已删除。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'providers'] });
    },
  });

  const switchMutation = useMutation({
    mutationFn: ({ providerId, app }: { providerId: string; app: string }) =>
      switchAiPlatformProvider(providerId, app),
    onSuccess: async (_, variables) => {
      setMessage(`已把 ${variables.app} 切换到所选 provider，并写入对应本地配置文件。`);
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'providers'] });
    },
  });

  const healthMutation = useMutation({
    mutationFn: checkAiPlatformProviderHealth,
    onSuccess: (health) => {
      setHealthByProvider((current) => ({ ...current, [health.providerId]: health }));
      setMessage(
        health.status === 'healthy'
          ? `健康检查通过：${health.target}${health.latencyMs ? `，${health.latencyMs}ms` : ''}`
          : `健康检查失败：${health.message}`,
      );
      void queryClient.invalidateQueries({ queryKey: ['ai-platform', 'providers'] });
    },
  });

  const reprioritizeMutation = useMutation({
    mutationFn: saveAiPlatformProvider,
    onSuccess: async () => {
      setMessage('Failover 优先级已更新。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'providers'] });
    },
  });

  const submitting =
    saveMutation.isPending ||
    deleteMutation.isPending ||
    switchMutation.isPending ||
    healthMutation.isPending ||
    reprioritizeMutation.isPending;

  async function checkVisibleProviders() {
    if (filteredProviders.length === 0) {
      setMessage('当前筛选下没有可检查的 provider。');
      return;
    }

    setBatchChecking(true);
    try {
      const results = await Promise.all(filteredProviders.map((provider) => checkAiPlatformProviderHealth(provider.id)));
      setHealthByProvider((current) => {
        const next = { ...current };
        for (const result of results) {
          next[result.providerId] = result;
        }
        return next;
      });

      const healthyCount = results.filter((result) => result.status === 'healthy').length;
      const degradedCount = results.filter((result) => result.status === 'degraded').length;
      const unreachableCount = results.filter((result) => result.status === 'unreachable').length;
      setMessage(
        `批量检查完成：healthy ${healthyCount}，degraded ${degradedCount}，unreachable ${unreachableCount}`,
      );
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'providers'] });
    } finally {
      setBatchChecking(false);
    }
  }

  const sourceLabel =
    data?.source === 'legacy-import'
      ? 'Legacy import'
      : data?.source === 'starter-seed'
        ? 'Starter seed'
        : 'New store';

  const activeCount = [
    data?.active.claude,
    data?.active.codex,
    data?.active.gemini,
    data?.active.opencode,
    data?.active.openclaw,
  ].filter(Boolean).length;

  function openCreateDraft() {
    setDraft(createEmptyDraft(filter));
    setMessage(null);
  }

  function saveDraft() {
    if (!draft) {
      return;
    }

    if (!draft.name.trim()) {
      setMessage('Provider name 不能为空。');
      return;
    }

    if (!Object.values(draft.apps).some(Boolean)) {
      setMessage('至少选择一个 app。');
      return;
    }

    const existing = data?.providers.find((provider) => provider.id === draft.id);
    saveMutation.mutate(toRecord(draft, existing));
  }

  return (
    <div className="ai-grid ai-gap-6">
      <section className="ai-rounded-xl ai-border ai-border-border ai-bg-card ai-p-6 ai-shadow-sm">
        <div className="ai-section-header">
          <div>
            <p className="ai-text-xs ai-font-semibold ai-uppercase ai-tracking-[0.2em] ai-text-muted-foreground">
              Domain
            </p>
            <h3 className="ai-mt-2 ai-text-2xl ai-font-semibold ai-text-card-foreground">Providers</h3>
            <p className="ai-mt-2 ai-text-sm ai-leading-6 ai-text-muted-foreground">
              这是新 ai_platform 的第一个真实纵切：当前已经接通新 store、旧数据导入、provider 切换和本地 CLI 配置写盘。
            </p>
          </div>
          <div className="ai-flex ai-gap-3 ai-items-center ai-wrap">
            <span className="ai-badge ai-badge-neutral">{sourceLabel}</span>
            <button
              type="button"
              className="ai-button ai-button-secondary"
              onClick={() => {
                void checkVisibleProviders();
              }}
              disabled={submitting || batchChecking || filteredProviders.length === 0}
            >
              {batchChecking ? 'Checking Visible...' : 'Check Visible'}
            </button>
            <button type="button" className="ai-button ai-button-primary" onClick={openCreateDraft}>
              New Provider
            </button>
          </div>
        </div>

        <div className="ai-stats-grid ai-mt-2">
          <article className="ai-stat-card">
            <span className="ai-stat-label">Providers</span>
            <strong className="ai-stat-value">{data?.providers.length ?? 0}</strong>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Active Bindings</span>
            <strong className="ai-stat-value">{activeCount}</strong>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Filter</span>
            <strong className="ai-stat-value">{filter === 'all' ? 'All Apps' : filter}</strong>
          </article>
        </div>

        <section className="ai-active-grid ai-mt-2">
          {activeEntries.map(({ app, provider }) => (
            <article key={app} className="ai-active-card">
              <span className="ai-stat-label">{app}</span>
              <strong className="ai-active-title">{provider?.name ?? 'Unbound'}</strong>
              <span className="ai-active-meta">
                {provider ? `priority ${provider.failoverPriority ?? 999}` : 'No active provider'}
              </span>
            </article>
          ))}
        </section>

        <section className="ai-history-panel ai-mt-2">
          <div className="ai-history-header">
            <div>
              <h4 className="ai-text-base ai-font-semibold ai-text-card-foreground">Recent Switches</h4>
              <p className="ai-mt-1 ai-text-sm ai-text-muted-foreground">
                最近 12 次 provider 激活记录，方便追踪当前切换轨迹。
              </p>
            </div>
          </div>
          <div className="ai-history-list">
            {(data?.switchHistory ?? []).length === 0 && (
              <div className="ai-history-item">
                <span className="ai-history-app">No history</span>
                <span className="ai-history-meta">还没有切换记录。</span>
              </div>
            )}
            {(data?.switchHistory ?? []).map((entry: ProviderSwitchHistory) => (
              <div key={`${entry.providerId}-${entry.app}-${entry.switchedAt}`} className="ai-history-item">
                <span className="ai-history-app">{entry.app}</span>
                <strong className="ai-history-provider">{entry.providerName}</strong>
                <span className="ai-history-meta">{formatTimestamp(entry.switchedAt)}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="ai-pill-row ai-mt-2">
          {appOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`ai-pill ${filter === option.id ? 'active' : ''}`}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {message && <p className="ai-inline-message ai-mt-2">{message}</p>}
        {error && <p className="ai-inline-message ai-inline-message-error ai-mt-2">{String(error)}</p>}
      </section>

      {draft && (
        <section className="ai-rounded-xl ai-border ai-border-border ai-bg-card ai-p-6 ai-shadow-sm">
          <div className="ai-flex ai-items-center ai-justify-between ai-gap-4">
            <div>
              <h4 className="ai-text-lg ai-font-semibold ai-text-card-foreground">
                {draft.id ? 'Edit Provider' : 'Create Provider'}
              </h4>
              <p className="ai-mt-1 ai-text-sm ai-text-muted-foreground">
                当前先聚焦首批核心字段，后续再补充高级模型段、健康检查和 failover 队列。
              </p>
            </div>
            <button type="button" className="ai-button ai-button-secondary" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>

          <div className="ai-form-grid ai-mt-2">
            <label className="ai-field">
              <span className="ai-field-label">Name</span>
              <input
                className="ai-input"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Anthropic Direct"
              />
            </label>
            <label className="ai-field">
              <span className="ai-field-label">Provider Type</span>
              <input
                className="ai-input"
                value={draft.providerType}
                onChange={(event) => setDraft({ ...draft, providerType: event.target.value })}
                placeholder="openai-compatible"
              />
            </label>
            <label className="ai-field ai-field-span-2">
              <span className="ai-field-label">Base URL</span>
              <input
                className="ai-input"
                value={draft.baseUrl}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                placeholder="https://api.anthropic.com"
              />
            </label>
            <label className="ai-field ai-field-span-2">
              <span className="ai-field-label">API Key</span>
              <input
                className="ai-input"
                value={draft.apiKey}
                onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                placeholder="sk-..."
              />
            </label>
            <label className="ai-field">
              <span className="ai-field-label">Primary Model</span>
              <input
                className="ai-input"
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                placeholder="claude-sonnet-4-20250514"
              />
            </label>
            <label className="ai-field">
              <span className="ai-field-label">Notes</span>
              <input
                className="ai-input"
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                placeholder="Bridge for CLI cutover"
              />
            </label>
            <label className="ai-field">
              <span className="ai-field-label">Failover Priority</span>
              <input
                className="ai-input"
                type="number"
                min={1}
                max={999}
                value={draft.failoverPriority}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    failoverPriority: Number.parseInt(event.target.value || '0', 10) || 1,
                  })
                }
              />
            </label>
          </div>

          <div className="ai-checkbox-row ai-mt-2">
            {(['claude', 'codex', 'gemini', 'opencode', 'openclaw'] as const).map((app) => (
              <label key={app} className="ai-checkbox-chip">
                <input
                  type="checkbox"
                  checked={draft.apps[app]}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      apps: { ...draft.apps, [app]: event.target.checked },
                    })
                  }
                />
                <span>{app}</span>
              </label>
            ))}
          </div>

          <div className="ai-flex ai-gap-3 ai-mt-2 ai-wrap">
            <button
              type="button"
              className="ai-button ai-button-primary"
              onClick={saveDraft}
              disabled={submitting}
            >
              {saveMutation.isPending ? 'Saving...' : 'Save Provider'}
            </button>
            <button type="button" className="ai-button ai-button-secondary" onClick={() => setDraft(null)}>
              Dismiss
            </button>
          </div>
        </section>
      )}

      <section className="ai-provider-workbench">
        <div className="ai-provider-grid">
          {isLoading && <article className="ai-provider-card">Loading provider store...</article>}

          {!isLoading && filteredProviders.length === 0 && (
            <article className="ai-provider-card">
              <h4 className="ai-text-base ai-font-semibold ai-text-card-foreground">No providers yet</h4>
              <p className="ai-mt-2 ai-text-sm ai-leading-6 ai-text-muted-foreground">
                当前筛选下还没有 provider。可以直接创建，也可以先切回 All 查看导入或 starter seed 的结果。
              </p>
            </article>
          )}

          {filteredProviders.map((provider) => {
            const activeApps = (['claude', 'codex', 'gemini', 'opencode', 'openclaw'] as const).filter(
              (app) => provider.apps[app],
            );
            const health = effectiveHealthByProvider[provider.id];

            return (
              <article
                key={provider.id}
                className={`ai-provider-card ${selectedProvider?.id === provider.id ? 'selected' : ''}`}
              >
                <div className="ai-flex ai-items-center ai-justify-between ai-gap-4">
                  <div>
                    <h4 className="ai-text-lg ai-font-semibold ai-text-card-foreground">{provider.name}</h4>
                    <p className="ai-mt-1 ai-text-sm ai-text-muted-foreground">{provider.providerType}</p>
                  </div>
                  <div className="ai-flex ai-gap-2 ai-wrap">
                    <button
                      type="button"
                      className="ai-button ai-button-secondary"
                      onClick={() => setSelectedProviderId(provider.id)}
                    >
                      Inspect
                    </button>
                    <button
                      type="button"
                      className="ai-button ai-button-secondary"
                      onClick={() => setDraft(toDraft(provider))}
                    >
                      Edit
                    </button>
                  </div>
                </div>

                <div className="ai-pill-row ai-mt-2">
                  {activeApps.map((app) => (
                    <span
                      key={app}
                      className={`ai-badge ${isActiveFor(provider, data?.active[app]) ? 'ai-badge-active' : 'ai-badge-neutral'}`}
                    >
                      {app}
                      {isActiveFor(provider, data?.active[app]) ? ' active' : ''}
                    </span>
                  ))}
                  {health && (
                    <span
                      className={`ai-badge ${health.status === 'healthy' ? 'ai-badge-success' : health.status === 'degraded' ? 'ai-badge-warning' : 'ai-badge-danger'}`}
                    >
                      {health.status}
                      {health.httpStatus ? ` ${health.httpStatus}` : ''}
                      {health.latencyMs ? ` ${health.latencyMs}ms` : ''}
                    </span>
                  )}
                  <span className="ai-badge ai-badge-neutral">P{provider.failoverPriority ?? 999}</span>
                </div>

                <p className="ai-mt-2 ai-text-sm ai-leading-6 ai-text-muted-foreground">
                  {provider.baseUrl || 'No base URL set'}
                </p>
                <p className="ai-mt-1 ai-text-sm ai-text-muted-foreground">
                  Model: {getPrimaryModel(provider) || 'Not configured'}
                </p>
                {health && (
                  <p className="ai-mt-1 ai-text-sm ai-text-muted-foreground">
                    Health: {health.message} via {health.target} ({health.checkMode}) · {formatTimestamp(health.checkedAt)}
                  </p>
                )}
                {provider.notes && <p className="ai-mt-1 ai-text-sm ai-text-muted-foreground">{provider.notes}</p>}

                <div className="ai-flex ai-gap-2 ai-mt-2 ai-wrap">
                  <button
                    type="button"
                    className="ai-button ai-button-secondary"
                    disabled={submitting || batchChecking}
                    onClick={() => healthMutation.mutate(provider.id)}
                  >
                    {healthMutation.isPending ? 'Checking...' : 'Check Health'}
                  </button>
                  <button
                    type="button"
                    className="ai-button ai-button-secondary"
                    disabled={submitting || batchChecking}
                    onClick={() =>
                      reprioritizeMutation.mutate({
                        ...provider,
                        failoverPriority: Math.max(1, (provider.failoverPriority ?? 50) - 1),
                      })
                    }
                  >
                    Promote
                  </button>
                  <button
                    type="button"
                    className="ai-button ai-button-secondary"
                    disabled={submitting || batchChecking}
                    onClick={() =>
                      reprioritizeMutation.mutate({
                        ...provider,
                        failoverPriority: Math.min(999, (provider.failoverPriority ?? 50) + 1),
                      })
                    }
                  >
                    Demote
                  </button>
                  {activeApps.map((app) => (
                    <button
                      key={app}
                      type="button"
                      className="ai-button ai-button-primary"
                      disabled={submitting || batchChecking}
                      onClick={() => switchMutation.mutate({ providerId: provider.id, app })}
                    >
                      {switchMutation.isPending ? 'Switching...' : `Activate ${app}`}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="ai-button ai-button-danger"
                    disabled={submitting || batchChecking}
                    onClick={() => deleteMutation.mutate(provider.id)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="ai-provider-detail-card">
          {selectedProvider ? (
            <>
              <div className="ai-detail-header">
                <div>
                  <p className="ai-text-xs ai-font-semibold ai-uppercase ai-tracking-[0.2em] ai-text-muted-foreground">
                    Selection
                  </p>
                  <h4 className="ai-mt-2 ai-text-lg ai-font-semibold ai-text-card-foreground">
                    {selectedProvider.name}
                  </h4>
                  <p className="ai-mt-1 ai-text-sm ai-text-muted-foreground">{selectedProvider.providerType}</p>
                </div>
                <span className="ai-badge ai-badge-neutral">P{selectedProvider.failoverPriority ?? 999}</span>
              </div>

              <div className="ai-detail-grid ai-mt-2">
                <div className="ai-detail-item">
                  <span className="ai-stat-label">Base URL</span>
                  <strong className="ai-detail-value">{selectedProvider.baseUrl || 'Unset'}</strong>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-stat-label">Primary Model</span>
                  <strong className="ai-detail-value">{getPrimaryModel(selectedProvider) || 'Unset'}</strong>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-stat-label">Apps</span>
                  <strong className="ai-detail-value">
                    {(['claude', 'codex', 'gemini', 'opencode', 'openclaw'] as const)
                      .filter((app) => selectedProvider.apps[app])
                      .join(', ') || 'None'}
                  </strong>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-stat-label">Last Health</span>
                  <strong className="ai-detail-value">
                    {selectedHealth
                      ? `${selectedHealth.status}${selectedHealth.httpStatus ? ` ${selectedHealth.httpStatus}` : ''}`
                      : 'Not checked'}
                  </strong>
                </div>
              </div>

              {selectedHealth && (
                <div className="ai-detail-note ai-mt-2">
                  {selectedHealth.message} via {selectedHealth.target} ({selectedHealth.checkMode}) ·{' '}
                  {formatTimestamp(selectedHealth.checkedAt)}
                </div>
              )}

              <div className="ai-detail-actions ai-mt-2">
                <button
                  type="button"
                  className="ai-button ai-button-secondary"
                  disabled={submitting || batchChecking}
                  onClick={() => healthMutation.mutate(selectedProvider.id)}
                >
                  Recheck Selected
                </button>
                <button
                  type="button"
                  className="ai-button ai-button-secondary"
                  onClick={() => setDraft(toDraft(selectedProvider))}
                >
                  Edit Selected
                </button>
              </div>

              <div className="ai-detail-history ai-mt-2">
                <h5 className="ai-text-base ai-font-semibold ai-text-card-foreground">Selected History</h5>
                <div className="ai-detail-history-list ai-mt-2">
                  {selectedHistory.length === 0 && (
                    <div className="ai-history-item">
                      <span className="ai-history-app">No events</span>
                      <span className="ai-history-meta">这个 provider 还没有切换记录。</span>
                    </div>
                  )}
                  {selectedHistory.map((entry) => (
                    <div key={`${entry.providerId}-${entry.app}-${entry.switchedAt}`} className="ai-history-item">
                      <span className="ai-history-app">{entry.app}</span>
                      <strong className="ai-history-provider">{entry.providerName}</strong>
                      <span className="ai-history-meta">{formatTimestamp(entry.switchedAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="ai-detail-empty">
              <h4 className="ai-text-base ai-font-semibold ai-text-card-foreground">No Selection</h4>
              <p className="ai-mt-2 ai-text-sm ai-text-muted-foreground">
                选择一个 provider 后，这里会显示它的激活状态、最近健康检查和切换记录。
              </p>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}