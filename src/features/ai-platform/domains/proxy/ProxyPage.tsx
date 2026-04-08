import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  type ProxyControlPlaneRecord,
  saveAiPlatformProxyConfig,
} from '../../infra/commands/proxy';
import { useAiPlatformProxy } from '../../infra/query/useAiPlatformProxy';

const apps = ['claude', 'codex', 'gemini', 'opencode', 'openclaw'] as const;

function cloneConfig(config: ProxyControlPlaneRecord): ProxyControlPlaneRecord {
  return JSON.parse(JSON.stringify(config)) as ProxyControlPlaneRecord;
}

export function ProxyPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useAiPlatformProxy();
  const [draft, setDraft] = useState<ProxyControlPlaneRecord | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!data) {
      return;
    }
    setDraft(cloneConfig(data.config));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (config: ProxyControlPlaneRecord) => saveAiPlatformProxyConfig(config),
    onSuccess: async (snapshot) => {
      setDraft(cloneConfig(snapshot.config));
      setMessage('Proxy 控制面配置已保存。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'proxy'] });
    },
    onError: (saveError) => {
      setMessage(String(saveError));
    },
  });

  const appStatuses = data?.appStatuses ?? [];
  const queue = data?.queue ?? [];

  const stats = useMemo(() => ({
    takeover: appStatuses.filter((item) => item.takeoverEnabled).length,
    failover: appStatuses.filter((item) => item.failoverEnabled).length,
    warnings: appStatuses.filter((item) => item.status === 'warning' || item.status === 'danger').length,
  }), [appStatuses]);

  function updateDraft(updater: (current: ProxyControlPlaneRecord) => ProxyControlPlaneRecord) {
    setDraft((current) => (current ? updater(current) : current));
    setMessage(null);
  }

  if (isLoading || !draft) {
    return <div className="ai-inline-message">正在加载 Proxy 控制台...</div>;
  }

  return (
    <div className="ai-grid ai-gap-6">
      <section className="ai-grid ai-gap-4">
        <div className="ai-section-header">
          <div className="ai-grid ai-gap-2">
            <span className="ai-text-xs ai-uppercase ai-tracking-[0.18em] ai-text-muted-foreground">
              Domain / Proxy
            </span>
            <div className="ai-grid ai-gap-2">
              <h2 className="ai-text-2xl ai-font-semibold ai-text-card-foreground">Proxy Control Plane</h2>
              <p className="ai-text-sm ai-text-muted-foreground ai-max-w-2xl">
                管理本地代理监听参数、接管 app、failover 策略以及基于 Providers 实时推导出的接管风险与队列顺序。
              </p>
            </div>
          </div>
          <div className="ai-flex ai-wrap ai-gap-3">
            <button
              className="ai-button ai-button-secondary"
              onClick={() => {
                if (!data) {
                  return;
                }
                setDraft(cloneConfig(data.config));
                setMessage('已恢复到最近一次已保存的 Proxy 配置。');
              }}
              type="button"
            >
              Reset
            </button>
            <button
              className={draft.server.running ? 'ai-button ai-button-danger' : 'ai-button ai-button-primary'}
              onClick={() =>
                updateDraft((current) => ({
                  ...current,
                  server: { ...current.server, running: !current.server.running },
                }))
              }
              type="button"
            >
              {draft.server.running ? 'Mark Stopped' : 'Mark Running'}
            </button>
            <button
              className="ai-button ai-button-primary"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate(draft)}
              type="button"
            >
              {saveMutation.isPending ? 'Saving...' : 'Save Proxy Config'}
            </button>
          </div>
        </div>

        <div className="ai-stats-grid">
          <article className="ai-stat-card">
            <span className="ai-stat-label">Takeover Apps</span>
            <span className="ai-stat-value">{stats.takeover}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Failover Apps</span>
            <span className="ai-stat-value">{stats.failover}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Warnings</span>
            <span className="ai-stat-value">{stats.warnings}</span>
          </article>
        </div>

        {message ? (
          <div className={`ai-inline-message ${saveMutation.isError || error ? 'ai-inline-message-error' : ''}`}>
            {message}
          </div>
        ) : null}
        {error ? <div className="ai-inline-message ai-inline-message-error">{String(error)}</div> : null}
      </section>

      <section className="ai-provider-workbench">
        <div className="ai-grid ai-gap-4">
          <article className="ai-provider-card ai-grid ai-gap-4">
            <div className="ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Server</h3>
              <p className="ai-text-sm ai-text-muted-foreground">首切片先落控制面状态与参数保存，后续可直接接入真实代理进程。</p>
            </div>
            <div className="ai-form-grid">
              <label className="ai-checkbox-chip ai-field-span-2">
                <input
                  checked={draft.server.running}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      server: { ...current.server, running: event.target.checked },
                    }))
                  }
                  type="checkbox"
                />
                Proxy running
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Listen Host</span>
                <input
                  className="ai-input"
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      server: { ...current.server, listenHost: event.target.value },
                    }))
                  }
                  value={draft.server.listenHost}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Listen Port</span>
                <input
                  className="ai-input"
                  min={1024}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      server: { ...current.server, listenPort: Number(event.target.value) || 1024 },
                    }))
                  }
                  type="number"
                  value={draft.server.listenPort}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Connect Timeout</span>
                <input
                  className="ai-input"
                  min={1}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      server: { ...current.server, connectTimeoutSeconds: Number(event.target.value) || 1 },
                    }))
                  }
                  type="number"
                  value={draft.server.connectTimeoutSeconds}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Request Timeout</span>
                <input
                  className="ai-input"
                  min={1}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      server: { ...current.server, requestTimeoutSeconds: Number(event.target.value) || 1 },
                    }))
                  }
                  type="number"
                  value={draft.server.requestTimeoutSeconds}
                />
              </label>
              <label className="ai-checkbox-chip">
                <input
                  checked={draft.server.logRequests}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      server: { ...current.server, logRequests: event.target.checked },
                    }))
                  }
                  type="checkbox"
                />
                Log requests
              </label>
              <label className="ai-checkbox-chip">
                <input
                  checked={draft.exposeProxyToggle}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      exposeProxyToggle: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                Show proxy toggle on main page
              </label>
              <label className="ai-checkbox-chip ai-field-span-2">
                <input
                  checked={draft.exposeFailoverToggle}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      exposeFailoverToggle: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                Show failover toggle on main page
              </label>
            </div>
          </article>

          <article className="ai-provider-card ai-grid ai-gap-4">
            <div className="ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Takeover & Failover</h3>
              <p className="ai-text-sm ai-text-muted-foreground">每个 app 独立控制接管与 failover，队列由 Providers 当前配置实时推导。</p>
            </div>
            <div className="ai-detail-history-list">
              {apps.map((app) => {
                const appStatus = appStatuses.find((item) => item.app === app);
                return (
                  <article className="ai-detail-item" key={app}>
                    <div className="ai-detail-header">
                      <span className="ai-text-base ai-font-medium ai-text-card-foreground">{app}</span>
                      <span
                        className={`ai-badge ${
                          appStatus?.status === 'success'
                            ? 'ai-badge-success'
                            : appStatus?.status === 'warning'
                              ? 'ai-badge-warning'
                              : appStatus?.status === 'danger'
                                ? 'ai-badge-danger'
                                : 'ai-badge-neutral'
                        }`}
                      >
                        {appStatus?.status ?? 'neutral'}
                      </span>
                    </div>
                    <div className="ai-checkbox-row">
                      <label className="ai-checkbox-chip">
                        <input
                          checked={draft.takeover[app]}
                          onChange={(event) =>
                            updateDraft((current) => ({
                              ...current,
                              takeover: { ...current.takeover, [app]: event.target.checked },
                            }))
                          }
                          type="checkbox"
                        />
                        Takeover
                      </label>
                      <label className="ai-checkbox-chip">
                        <input
                          checked={draft.failover[app]}
                          onChange={(event) =>
                            updateDraft((current) => ({
                              ...current,
                              failover: { ...current.failover, [app]: event.target.checked },
                            }))
                          }
                          type="checkbox"
                        />
                        Failover
                      </label>
                    </div>
                    <div className="ai-detail-value">{appStatus?.detail ?? 'No status yet.'}</div>
                  </article>
                );
              })}
            </div>
          </article>

          <article className="ai-provider-card ai-grid ai-gap-4">
            <div className="ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Failover Policy</h3>
              <p className="ai-text-sm ai-text-muted-foreground">这组参数先用于治理和风险显示，后续接真实熔断器时可直接复用。</p>
            </div>
            <div className="ai-form-grid">
              <label className="ai-checkbox-chip ai-field-span-2">
                <input
                  checked={draft.failoverPolicy.enabled}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      failoverPolicy: { ...current.failoverPolicy, enabled: event.target.checked },
                    }))
                  }
                  type="checkbox"
                />
                Enable automatic failover
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Consecutive Failures</span>
                <input
                  className="ai-input"
                  min={1}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      failoverPolicy: {
                        ...current.failoverPolicy,
                        consecutiveFailures: Number(event.target.value) || 1,
                      },
                    }))
                  }
                  type="number"
                  value={draft.failoverPolicy.consecutiveFailures}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Cooldown Seconds</span>
                <input
                  className="ai-input"
                  min={1}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      failoverPolicy: { ...current.failoverPolicy, cooldownSeconds: Number(event.target.value) || 1 },
                    }))
                  }
                  type="number"
                  value={draft.failoverPolicy.cooldownSeconds}
                />
              </label>
            </div>
          </article>
        </div>

        <aside className="ai-provider-detail-card ai-grid ai-gap-4">
          <div className="ai-grid ai-gap-2">
            <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Queue</h3>
            <p className="ai-text-sm ai-text-muted-foreground">按 app 分组展示当前 failover 顺序，排序来源于 Provider 的 failoverPriority。</p>
          </div>

          <div className="ai-detail-history-list">
            {apps.map((app) => {
              const items = queue
                .filter((item) => item.app === app)
                .sort((left, right) => left.priority - right.priority);
              return (
                <article className="ai-detail-item" key={app}>
                  <div className="ai-detail-header">
                    <span className="ai-text-base ai-font-medium ai-text-card-foreground">{app}</span>
                    <span className="ai-badge ai-badge-neutral">{items.length}</span>
                  </div>
                  {items.length === 0 ? (
                    <div className="ai-detail-value">No provider queue.</div>
                  ) : (
                    <div className="ai-detail-history-list">
                      {items.map((item) => (
                        <div className="ai-detail-item" key={`${item.app}:${item.providerId}`}>
                          <div className="ai-detail-header">
                            <span className="ai-text-sm ai-font-medium ai-text-card-foreground">
                              P{item.priority} · {item.providerName}
                            </span>
                            <span className={`ai-badge ${item.isActive ? 'ai-badge-success' : 'ai-badge-neutral'}`}>
                              {item.isActive ? 'Active' : item.providerType}
                            </span>
                          </div>
                          <div className="ai-detail-value">
                            {item.requiresProxy ? 'Requires proxy' : 'Direct capable'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="ai-detail-note">Source: {data?.source}</div>
        </aside>
      </section>
    </div>
  );
}