import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { AuthConnection } from '../../infra/commands/auth';
import { useAiPlatformAuth } from '../../infra/query/useAiPlatformAuth';

function formatTimestamp(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'ready':
      return 'ai-badge-success';
    case 'degraded':
      return 'ai-badge-warning';
    case 'missing':
      return 'ai-badge-danger';
    default:
      return 'ai-badge-neutral';
  }
}

function levelClass(level: string) {
  switch (level) {
    case 'success':
      return 'ai-badge-success';
    case 'warning':
      return 'ai-badge-warning';
    case 'danger':
      return 'ai-badge-danger';
    default:
      return 'ai-badge-neutral';
  }
}

export function AuthPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useAiPlatformAuth();
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const connections = data?.connections ?? [];

  useEffect(() => {
    if (connections.length === 0) {
      setSelectedApp(null);
      return;
    }
    if (!selectedApp || !connections.some((item) => item.app === selectedApp)) {
      setSelectedApp(connections[0].app);
    }
  }, [connections, selectedApp]);

  const selectedConnection = useMemo(
    () => connections.find((item) => item.app === selectedApp) ?? connections[0],
    [connections, selectedApp],
  );

  const stats = useMemo(
    () => ({
      connected: connections.filter((item) => item.activeProviderId).length,
      ready: connections.filter((item) => item.status === 'ready').length,
      localFiles: connections.filter((item) => item.localConfigPresent).length,
      missing: connections.filter((item) => item.status === 'missing').length,
    }),
    [connections],
  );

  async function copyPaths(connection: AuthConnection) {
    const payload = connection.localConfigTargets.join('\n');
    await globalThis.navigator.clipboard.writeText(payload);
    setMessage(`${connection.label} 的本地配置路径已复制。`);
  }

  if (isLoading) {
    return <div className="ai-inline-message">正在加载 Auth 控制台...</div>;
  }

  return (
    <div className="ai-grid ai-gap-6">
      <section className="ai-grid ai-gap-4">
        <div className="ai-section-header">
          <div className="ai-grid ai-gap-2">
            <span className="ai-text-xs ai-uppercase ai-tracking-[0.18em] ai-text-muted-foreground">
              Domain / Auth
            </span>
            <div className="ai-grid ai-gap-2">
              <h2 className="ai-text-2xl ai-font-semibold ai-text-card-foreground">Auth Control Surface</h2>
              <p className="ai-text-sm ai-text-muted-foreground ai-max-w-2xl">
                汇总 Claude、Codex、Gemini、OpenCode、OpenClaw 的 active provider 绑定、本地接入文件和 token 可见性，作为新的鉴权观测面板。
              </p>
            </div>
          </div>
          <div className="ai-flex ai-wrap ai-gap-3">
            <button
              className="ai-button ai-button-secondary"
              onClick={() => {
                setMessage('已刷新 Auth 快照。');
                void queryClient.invalidateQueries({ queryKey: ['ai-platform', 'auth'] });
              }}
              type="button"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="ai-stats-grid">
          <article className="ai-stat-card">
            <span className="ai-stat-label">Bound Apps</span>
            <span className="ai-stat-value">{stats.connected}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Ready</span>
            <span className="ai-stat-value">{stats.ready}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Local Files</span>
            <span className="ai-stat-value">{stats.localFiles}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Missing</span>
            <span className="ai-stat-value">{stats.missing}</span>
          </article>
        </div>

        {message ? <div className="ai-inline-message">{message}</div> : null}
        {error ? <div className="ai-inline-message ai-inline-message-error">{String(error)}</div> : null}
      </section>

      <section className="ai-grid ai-gap-4">
        <div className="ai-provider-grid">
          {connections.map((connection) => (
            <article
              className={`ai-provider-card ${selectedConnection?.app === connection.app ? 'selected' : ''}`}
              key={connection.app}
            >
              <div className="ai-detail-header">
                <div className="ai-grid ai-gap-1">
                  <button className="ai-card-title-button" onClick={() => setSelectedApp(connection.app)} type="button">
                    {connection.label}
                  </button>
                  <span className="ai-text-sm ai-text-muted-foreground">
                    {connection.activeProviderName ?? 'No active provider'}
                  </span>
                </div>
                <span className={`ai-badge ${statusBadgeClass(connection.status)}`}>{connection.status}</span>
              </div>
              <p className="ai-text-sm ai-text-muted-foreground">{connection.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ai-provider-workbench">
        <aside className="ai-provider-detail-card ai-grid ai-gap-4">
          {selectedConnection ? (
            <>
              <div className="ai-detail-header">
                <div className="ai-grid ai-gap-2">
                  <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">{selectedConnection.label}</h3>
                  <span className="ai-text-sm ai-text-muted-foreground">
                    {selectedConnection.activeProviderId ?? 'unbound'}
                  </span>
                </div>
                <span className={`ai-badge ${statusBadgeClass(selectedConnection.status)}`}>{selectedConnection.status}</span>
              </div>

              <div className="ai-detail-grid">
                <div className="ai-detail-item">
                  <span className="ai-field-label">Provider</span>
                  <span className="ai-detail-value">{selectedConnection.activeProviderName ?? 'N/A'}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Provider Type</span>
                  <span className="ai-detail-value">{selectedConnection.providerType ?? 'N/A'}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Base URL</span>
                  <span className="ai-detail-value">{selectedConnection.baseUrl ?? 'N/A'}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Model</span>
                  <span className="ai-detail-value">{selectedConnection.model ?? 'N/A'}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Provider Token</span>
                  <span className="ai-detail-value">{selectedConnection.providerTokenPresent ? 'Present' : 'Missing'}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Local Token</span>
                  <span className="ai-detail-value">{selectedConnection.localTokenPresent ? 'Present' : 'Missing'}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Token Source</span>
                  <span className="ai-detail-value">{selectedConnection.tokenSource ?? 'N/A'}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Local Files</span>
                  <span className="ai-detail-value">{selectedConnection.localConfigPresent ? 'Present' : 'Missing'}</span>
                </div>
              </div>

              <div className="ai-grid ai-gap-2">
                <span className="ai-field-label">Config Targets</span>
                <div className="ai-detail-history-list">
                  {selectedConnection.localConfigTargets.map((target) => (
                    <div className="ai-detail-item" key={target}>
                      <span className="ai-detail-value">{target}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="ai-detail-actions">
                <button className="ai-button ai-button-secondary" onClick={() => void copyPaths(selectedConnection)} type="button">
                  Copy Config Paths
                </button>
              </div>
            </>
          ) : (
            <div className="ai-detail-empty ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">No auth surface selected</h3>
              <p className="ai-text-sm ai-text-muted-foreground">左侧会列出每个 app 的鉴权接入状态。</p>
            </div>
          )}
        </aside>

        <div className="ai-grid ai-gap-4">
          <article className="ai-provider-card ai-grid ai-gap-3">
            <div className="ai-grid ai-gap-1">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Auth Statuses</h3>
              <p className="ai-text-sm ai-text-muted-foreground">聚合级别的问题与提示，优先用于发现绑定、token 和本地桥接缺口。</p>
            </div>
            <div className="ai-detail-history-list">
              {(data?.statuses ?? []).map((status) => (
                <div className="ai-detail-item" key={status.id}>
                  <div className="ai-detail-header">
                    <span className="ai-text-sm ai-font-medium ai-text-card-foreground">{status.title}</span>
                    <span className={`ai-badge ${levelClass(status.level)}`}>{status.level}</span>
                  </div>
                  <div className="ai-detail-value">{status.detail}</div>
                </div>
              ))}
            </div>
          </article>

          <article className="ai-provider-card ai-grid ai-gap-3">
            <div className="ai-grid ai-gap-1">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Recent Switches</h3>
              <p className="ai-text-sm ai-text-muted-foreground">复用 Providers 的切换历史，帮助定位最近一次绑定切换。</p>
            </div>
            <div className="ai-detail-history-list">
              {(data?.switchHistory ?? []).length === 0 ? (
                <div className="ai-detail-value">No switch history yet.</div>
              ) : (
                (data?.switchHistory ?? []).map((entry) => (
                  <div className="ai-detail-item" key={`${entry.providerId}-${entry.app}-${entry.switchedAt}`}>
                    <div className="ai-detail-header">
                      <span className="ai-text-sm ai-font-medium ai-text-card-foreground">{entry.providerName}</span>
                      <span className="ai-badge ai-badge-neutral">{entry.app}</span>
                    </div>
                    <div className="ai-detail-value">{formatTimestamp(entry.switchedAt)}</div>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="ai-provider-card ai-grid ai-gap-3">
            <div className="ai-grid ai-gap-1">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Snapshot Source</h3>
              <p className="ai-text-sm ai-text-muted-foreground">当前 Auth 快照来自已初始化 provider store 与本地配置文件扫描。</p>
            </div>
            <div className="ai-detail-value">{data?.source ?? 'unknown'}</div>
          </article>
        </div>
      </section>
    </div>
  );
}