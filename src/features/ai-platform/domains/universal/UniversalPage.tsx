import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAiPlatformUniversal } from '../../infra/query/useAiPlatformUniversal';

const appOrder = ['claude', 'codex', 'gemini', 'opencode', 'openclaw'] as const;

function badgeClass(level: string) {
  switch (level) {
    case 'ready':
    case 'success':
      return 'ai-badge-success';
    case 'warning':
    case 'degraded':
      return 'ai-badge-warning';
    case 'danger':
    case 'missing':
      return 'ai-badge-danger';
    default:
      return 'ai-badge-neutral';
  }
}

export function UniversalPage() {
  const queryClient = useQueryClient();
  const { providers, auth, proxy, agents, settings, openclaw, isLoading, error } = useAiPlatformUniversal();

  const appMatrix = useMemo(
    () =>
      appOrder.map((app) => {
        const authEntry = auth?.connections.find((item) => item.app === app);
        const proxyEntry = proxy?.appStatuses.find((item) => item.app === app);
        const provider = providers?.providers.find((item) => item.id === authEntry?.activeProviderId);
        const agentCount = (agents?.agents ?? []).filter((item) => item.assignment.providerId === authEntry?.activeProviderId).length;
        return {
          app,
          label: authEntry?.label ?? app,
          providerName: authEntry?.activeProviderName ?? 'Unbound',
          providerType: authEntry?.providerType ?? provider?.providerType ?? 'N/A',
          model:
            authEntry?.model ??
            provider?.models.claude?.model ??
            provider?.models.codex?.model ??
            provider?.models.gemini?.model ??
            provider?.models.opencode?.model ??
            provider?.models.openclaw?.model ??
            'N/A',
          authStatus: authEntry?.status ?? 'missing',
          authDetail: authEntry?.detail ?? 'No auth snapshot',
          localConfigPresent: authEntry?.localConfigPresent ?? false,
          takeoverEnabled: proxyEntry?.takeoverEnabled ?? false,
          failoverEnabled: proxyEntry?.failoverEnabled ?? false,
          queueDepth: proxyEntry?.queueDepth ?? 0,
          requiresProxy: proxyEntry?.requiresProxy ?? false,
          proxyStatus: proxyEntry?.status ?? 'unknown',
          agentCount,
        };
      }),
    [agents?.agents, auth?.connections, providers?.providers, proxy?.appStatuses],
  );

  const providerCards = useMemo(
    () =>
      (providers?.providers ?? [])
        .filter((provider) => provider.enabled)
        .map((provider) => ({
          id: provider.id,
          name: provider.name,
          type: provider.providerType,
          apps: appOrder.filter((app) => {
            if (app === 'claude') return provider.apps.claude;
            if (app === 'codex') return provider.apps.codex;
            if (app === 'gemini') return provider.apps.gemini;
            if (app === 'opencode') return provider.apps.opencode;
            return provider.apps.openclaw;
          }),
          activeFor: appMatrix.filter((row) => row.providerName === provider.name).map((row) => row.label),
          assignedAgents: (agents?.agents ?? []).filter((item) => item.assignment.providerId === provider.id).length,
        })),
    [agents?.agents, appMatrix, providers?.providers],
  );

  const stats = useMemo(
    () => ({
      providers: (providers?.providers ?? []).filter((provider) => provider.enabled).length,
      authReady: appMatrix.filter((row) => row.authStatus === 'ready').length,
      proxyTakeover: appMatrix.filter((row) => row.takeoverEnabled).length,
      routedAgents: (agents?.agents ?? []).filter((item) => item.enabled && item.assignment.providerId).length,
    }),
    [agents?.agents, appMatrix, providers?.providers],
  );

  if (isLoading) {
    return <div className="ai-inline-message">正在加载 Universal 联邦视图...</div>;
  }

  return (
    <div className="ai-grid ai-gap-6">
      <section className="ai-grid ai-gap-4">
        <div className="ai-section-header">
          <div className="ai-grid ai-gap-2">
            <span className="ai-text-xs ai-uppercase ai-tracking-[0.18em] ai-text-muted-foreground">
              Domain / Universal
            </span>
            <div className="ai-grid ai-gap-2">
              <h2 className="ai-text-2xl ai-font-semibold ai-text-card-foreground">Federated Control Matrix</h2>
              <p className="ai-text-sm ai-text-muted-foreground ai-max-w-3xl">
                把 Providers、Auth、Proxy、Agents、Settings 和 OpenClaw 的快照合并成一个总览面板，用来快速判断跨 app 供应链是否已经打通。
              </p>
            </div>
          </div>
          <div className="ai-flex ai-wrap ai-gap-3">
            <button
              className="ai-button ai-button-secondary"
              onClick={() => {
                void Promise.all([
                  queryClient.invalidateQueries({ queryKey: ['ai-platform', 'providers'] }),
                  queryClient.invalidateQueries({ queryKey: ['ai-platform', 'auth'] }),
                  queryClient.invalidateQueries({ queryKey: ['ai-platform', 'proxy'] }),
                  queryClient.invalidateQueries({ queryKey: ['ai-platform', 'agents'] }),
                  queryClient.invalidateQueries({ queryKey: ['ai-platform', 'settings'] }),
                  queryClient.invalidateQueries({ queryKey: ['ai-platform', 'openclaw'] }),
                ]);
              }}
              type="button"
            >
              Refresh All
            </button>
          </div>
        </div>

        <div className="ai-stats-grid">
          <article className="ai-stat-card">
            <span className="ai-stat-label">Enabled Providers</span>
            <span className="ai-stat-value">{stats.providers}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Auth Ready</span>
            <span className="ai-stat-value">{stats.authReady}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Proxy Takeover</span>
            <span className="ai-stat-value">{stats.proxyTakeover}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Routed Agents</span>
            <span className="ai-stat-value">{stats.routedAgents}</span>
          </article>
        </div>

        {error ? <div className="ai-inline-message ai-inline-message-error">{String(error)}</div> : null}
      </section>

      <section className="ai-grid ai-gap-4">
        <div className="ai-grid ai-gap-2">
          <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">App Matrix</h3>
          <p className="ai-text-sm ai-text-muted-foreground">逐个 app 查看当前 active provider、auth readiness、proxy 接管与 agent 覆盖情况。</p>
        </div>
        <div className="ai-provider-grid">
          {appMatrix.map((row) => (
            <article className="ai-provider-card ai-grid ai-gap-3" key={row.app}>
              <div className="ai-detail-header">
                <div className="ai-grid ai-gap-1">
                  <h4 className="ai-text-base ai-font-semibold ai-text-card-foreground">{row.label}</h4>
                  <span className="ai-text-sm ai-text-muted-foreground">{row.providerName}</span>
                </div>
                <span className={`ai-badge ${badgeClass(row.authStatus)}`}>{row.authStatus}</span>
              </div>
              <div className="ai-detail-grid">
                <div className="ai-detail-item">
                  <span className="ai-field-label">Provider Type</span>
                  <span className="ai-detail-value">{row.providerType}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Model</span>
                  <span className="ai-detail-value">{row.model}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Local Config</span>
                  <span className="ai-detail-value">{row.localConfigPresent ? 'Present' : 'Missing'}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Proxy</span>
                  <span className="ai-detail-value">
                    {row.takeoverEnabled ? 'Takeover' : 'Direct'} / {row.failoverEnabled ? 'Failover On' : 'Failover Off'}
                  </span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Queue Depth</span>
                  <span className="ai-detail-value">{row.queueDepth}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Agent Routes</span>
                  <span className="ai-detail-value">{row.agentCount}</span>
                </div>
              </div>
              <p className="ai-text-sm ai-text-muted-foreground">{row.authDetail}</p>
              <div className="ai-flex ai-wrap ai-gap-2">
                <span className={`ai-badge ${badgeClass(row.proxyStatus)}`}>{row.proxyStatus}</span>
                <span className={`ai-badge ${row.requiresProxy ? 'ai-badge-warning' : 'ai-badge-neutral'}`}>
                  {row.requiresProxy ? 'Proxy Required' : 'Proxy Optional'}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="ai-provider-workbench">
        <div className="ai-grid ai-gap-4">
          <article className="ai-provider-card ai-grid ai-gap-3">
            <div className="ai-grid ai-gap-1">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Provider Coverage</h3>
              <p className="ai-text-sm ai-text-muted-foreground">每个 enabled provider 当前覆盖哪些 app，以及承担了多少 agent 路由。</p>
            </div>
            <div className="ai-detail-history-list">
              {providerCards.map((provider) => (
                <div className="ai-detail-item" key={provider.id}>
                  <div className="ai-detail-header">
                    <span className="ai-text-sm ai-font-medium ai-text-card-foreground">{provider.name}</span>
                    <span className="ai-badge ai-badge-neutral">{provider.type}</span>
                  </div>
                  <div className="ai-detail-value">
                    apps: {provider.apps.length > 0 ? provider.apps.join(', ') : 'none'}
                  </div>
                  <div className="ai-detail-value">
                    active: {provider.activeFor.length > 0 ? provider.activeFor.join(', ') : 'none'}
                  </div>
                  <div className="ai-detail-value">agents: {provider.assignedAgents}</div>
                </div>
              ))}
            </div>
          </article>

          <article className="ai-provider-card ai-grid ai-gap-3">
            <div className="ai-grid ai-gap-1">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Cross-domain Signals</h3>
              <p className="ai-text-sm ai-text-muted-foreground">把 Auth、Settings 和 OpenClaw 的关键信号拉平到一页查看。</p>
            </div>
            <div className="ai-detail-history-list">
              {(auth?.statuses ?? []).map((status) => (
                <div className="ai-detail-item" key={`auth-${status.id}`}>
                  <div className="ai-detail-header">
                    <span className="ai-text-sm ai-font-medium ai-text-card-foreground">Auth / {status.title}</span>
                    <span className={`ai-badge ${badgeClass(status.level)}`}>{status.level}</span>
                  </div>
                  <div className="ai-detail-value">{status.detail}</div>
                </div>
              ))}
              {(settings?.statuses ?? []).map((status) => (
                <div className="ai-detail-item" key={`settings-${status.id}`}>
                  <div className="ai-detail-header">
                    <span className="ai-text-sm ai-font-medium ai-text-card-foreground">Settings / {status.label}</span>
                    <span className={`ai-badge ${badgeClass(status.level)}`}>{status.level}</span>
                  </div>
                  <div className="ai-detail-value">{status.detail}</div>
                </div>
              ))}
              {(openclaw?.health ?? []).map((status) => (
                <div className="ai-detail-item" key={`openclaw-${status.id}`}>
                  <div className="ai-detail-header">
                    <span className="ai-text-sm ai-font-medium ai-text-card-foreground">OpenClaw / {status.title}</span>
                    <span className={`ai-badge ${badgeClass(status.level)}`}>{status.level}</span>
                  </div>
                  <div className="ai-detail-value">{status.detail}</div>
                </div>
              ))}
            </div>
          </article>
        </div>

        <aside className="ai-provider-detail-card ai-grid ai-gap-4">
          <div className="ai-grid ai-gap-2">
            <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Runtime Snapshot</h3>
            <p className="ai-text-sm ai-text-muted-foreground">
              当前代理监听 {proxy?.config.server.listenHost}:{proxy?.config.server.listenPort}，路由模式 {agents?.routingMode ?? 'unset'}，OpenClaw bridge {openclaw?.bridgeSummary ?? 'unset'}。
            </p>
          </div>

          <div className="ai-detail-grid">
            <div className="ai-detail-item">
              <span className="ai-field-label">Theme / Language</span>
              <span className="ai-detail-value">
                {settings?.settings.appearance.theme ?? 'unset'} / {settings?.settings.appearance.language ?? 'unset'}
              </span>
            </div>
            <div className="ai-detail-item">
              <span className="ai-field-label">Default Workspace</span>
              <span className="ai-detail-value">{settings?.settings.directories.defaultWorkspaceRoot || 'unset'}</span>
            </div>
            <div className="ai-detail-item">
              <span className="ai-field-label">Proxy Running</span>
              <span className="ai-detail-value">{proxy?.config.server.running ? 'true' : 'false'}</span>
            </div>
            <div className="ai-detail-item">
              <span className="ai-field-label">OpenClaw Config</span>
              <span className="ai-detail-value">{openclaw?.exists ? 'Present' : 'Missing'}</span>
            </div>
          </div>

          <div className="ai-detail-history-list">
            <div className="ai-detail-item">
              <span className="ai-field-label">Sources</span>
              <div className="ai-detail-value">providers: {providers?.source ?? 'unknown'}</div>
              <div className="ai-detail-value">auth: {auth?.source ?? 'unknown'}</div>
              <div className="ai-detail-value">proxy: {proxy?.source ?? 'unknown'}</div>
              <div className="ai-detail-value">agents: {agents?.source ?? 'unknown'}</div>
              <div className="ai-detail-value">openclaw: {openclaw?.source ?? 'unknown'}</div>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}