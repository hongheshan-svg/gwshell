import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  deleteAiPlatformMcpServer,
  type McpServerRecord,
  type McpServerValidation,
  type McpSyncApps,
  saveAiPlatformMcpServer,
  syncAiPlatformMcpServers,
} from '../../infra/commands/mcp';
import { useAiPlatformMcp } from '../../infra/query/useAiPlatformMcp';

interface McpDraft {
  id?: string;
  name: string;
  command: string;
  args: string;
  env: string;
  syncApps: McpSyncApps;
  enabled: boolean;
}

const appOptions: Array<{ id: keyof McpSyncApps; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'opencode', label: 'OpenCode' },
];

function emptySyncApps(): McpSyncApps {
  return {
    claude: true,
    codex: true,
    gemini: true,
    opencode: true,
  };
}

function createDraft(server?: McpServerRecord): McpDraft {
  if (!server) {
    return {
      name: '',
      command: '',
      args: '',
      env: '',
      syncApps: emptySyncApps(),
      enabled: true,
    };
  }

  return {
    id: server.id,
    name: server.name,
    command: server.command,
    args: server.args.join('\n'),
    env: Object.entries(server.env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    syncApps: { ...server.syncApps },
    enabled: server.enabled,
  };
}

function createTemplateDraft(template: McpServerRecord): McpDraft {
  return {
    name: template.name,
    command: template.command,
    args: template.args.join('\n'),
    env: Object.entries(template.env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    syncApps: { ...template.syncApps },
    enabled: template.enabled,
  };
}

function parseLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseEnv(value: string) {
  return parseLines(value).reduce<Record<string, string>>((accumulator, line) => {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      return accumulator;
    }
    const key = line.slice(0, separatorIndex).trim();
    const envValue = line.slice(separatorIndex + 1).trim();
    if (!key) {
      return accumulator;
    }
    accumulator[key] = envValue;
    return accumulator;
  }, {});
}

function toRecord(draft: McpDraft): McpServerRecord {
  return {
    id: draft.id ?? globalThis.crypto.randomUUID(),
    name: draft.name.trim(),
    command: draft.command.trim(),
    args: parseLines(draft.args),
    env: parseEnv(draft.env),
    syncApps: draft.syncApps,
    enabled: draft.enabled,
  };
}

function getValidationTone(validation: McpServerValidation | undefined) {
  if (!validation || validation.status === 'ok') {
    return 'ai-badge-success';
  }
  if (validation.status === 'warning') {
    return 'ai-badge-warning';
  }
  return 'ai-badge-danger';
}

function getValidationLabel(validation: McpServerValidation | undefined) {
  if (!validation || validation.status === 'ok') {
    return 'Validated';
  }
  if (validation.status === 'warning') {
    return 'Needs Review';
  }
  return 'Invalid';
}

function getSyncTone(status: string) {
  switch (status) {
    case 'synced':
      return 'ai-badge-success';
    case 'partial':
      return 'ai-badge-warning';
    case 'idle':
      return 'ai-badge-neutral';
    default:
      return 'ai-badge-danger';
  }
}

function formatAppLabel(app: string) {
  switch (app) {
    case 'claude':
      return 'Claude';
    case 'codex':
      return 'Codex';
    case 'gemini':
      return 'Gemini';
    case 'opencode':
      return 'OpenCode';
    default:
      return app;
  }
}

export function McpPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useAiPlatformMcp();
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [draft, setDraft] = useState<McpDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const validationsByServer = useMemo(
    () => Object.fromEntries((data?.validations ?? []).map((validation) => [validation.serverId, validation])),
    [data?.validations],
  );

  const syncStatuses = data?.syncStatuses ?? [];

  const servers = useMemo(
    () => [...(data?.servers ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
    [data?.servers],
  );

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === selectedServerId) ?? servers[0],
    [servers, selectedServerId],
  );

  useEffect(() => {
    if (servers.length === 0) {
      setSelectedServerId(null);
      return;
    }
    if (!selectedServerId || !servers.some((server) => server.id === selectedServerId)) {
      setSelectedServerId(servers[0].id);
    }
  }, [selectedServerId, servers]);

  const saveMutation = useMutation({
    mutationFn: saveAiPlatformMcpServer,
    onSuccess: async () => {
      setMessage('MCP server 已保存，并已同步到本地 app 配置。');
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'mcp'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAiPlatformMcpServer,
    onSuccess: async () => {
      setMessage('MCP server 已删除。');
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'mcp'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: syncAiPlatformMcpServers,
    onSuccess: (result) => {
      setMessage(`${result.message}${result.syncedApps.length ? `: ${result.syncedApps.join(', ')}` : ''}`);
    },
  });

  const enabledCount = servers.filter((server) => server.enabled).length;
  const activeTargets = servers.reduce(
    (total, server) =>
      total + Object.values(server.syncApps).filter(Boolean).length,
    0,
  );
  const invalidCount = (data?.validations ?? []).filter((validation) => validation.status === 'error').length;
  const warningCount = (data?.validations ?? []).filter((validation) => validation.status === 'warning').length;
  const selectedValidation = selectedServer ? validationsByServer[selectedServer.id] : undefined;
  const selectedSyncStatuses = useMemo(
    () =>
      selectedServer
        ? syncStatuses.filter((status) => {
            const appKey = status.app as keyof McpSyncApps;
            return selectedServer.syncApps[appKey];
          })
        : syncStatuses,
    [selectedServer, syncStatuses],
  );

  return (
    <div className="ai-grid ai-gap-6">
      <section className="ai-grid ai-gap-4">
        <div className="ai-section-header">
          <div className="ai-grid ai-gap-2">
            <span className="ai-text-xs ai-uppercase ai-tracking-[0.18em] ai-text-muted-foreground">
              Domain / MCP
            </span>
            <div className="ai-grid ai-gap-2">
              <h2 className="ai-text-2xl ai-font-semibold ai-text-card-foreground">MCP Control Plane</h2>
              <p className="ai-text-sm ai-text-muted-foreground ai-max-w-2xl">
                统一管理 MCP server、模板和跨 Claude/Codex/Gemini/OpenCode 的本地配置同步。
              </p>
            </div>
          </div>
          <div className="ai-flex ai-wrap ai-gap-3">
            <button
              className="ai-button ai-button-secondary"
              onClick={() => setDraft(createDraft())}
              type="button"
            >
              New Server
            </button>
            <button
              className="ai-button ai-button-primary"
              disabled={syncMutation.isPending}
              onClick={() => syncMutation.mutate()}
              type="button"
            >
              {syncMutation.isPending ? 'Syncing...' : 'Sync All'}
            </button>
          </div>
        </div>

        <div className="ai-stats-grid">
          <article className="ai-stat-card">
            <span className="ai-stat-label">Configured</span>
            <span className="ai-stat-value">{servers.length}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Enabled</span>
            <span className="ai-stat-value">{enabledCount}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Sync Targets</span>
            <span className="ai-stat-value">{activeTargets}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Validation</span>
            <span className="ai-stat-value">{invalidCount > 0 ? `${invalidCount} invalid` : `${warningCount} warnings`}</span>
          </article>
        </div>

        {message ? <div className="ai-inline-message">{message}</div> : null}
        {error ? <div className="ai-inline-message ai-inline-message-error">{String(error)}</div> : null}

        <div className="ai-sync-grid">
          {syncStatuses.map((status) => (
            <article className="ai-active-card" key={status.app}>
              <div className="ai-detail-header">
                <strong className="ai-active-title">{formatAppLabel(status.app)}</strong>
                <span className={`ai-badge ${getSyncTone(status.status)}`}>{status.status}</span>
              </div>
              <span className="ai-active-meta">
                {status.syncedServers}/{status.targetedServers} synced
              </span>
              <span className="ai-active-meta">{status.message}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="ai-provider-workbench">
        <div className="ai-grid ai-gap-4">
          {isLoading ? <div className="ai-inline-message">正在加载 MCP servers...</div> : null}

          {servers.length === 0 && !isLoading ? (
            <article className="ai-provider-card ai-grid ai-gap-3">
              <div className="ai-grid ai-gap-2">
                <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">No MCP servers yet</h3>
                <p className="ai-text-sm ai-text-muted-foreground">
                  可以从右侧模板快速起步，或直接新建自定义 server。
                </p>
              </div>
            </article>
          ) : null}

          <div className="ai-provider-grid">
            {servers.map((server) => (
              <article
                className={`ai-provider-card ${selectedServer?.id === server.id ? 'selected' : ''}`}
                key={server.id}
              >
                <div className="ai-flex ai-justify-between ai-items-center ai-mt-1">
                  <span className={`ai-badge ${getValidationTone(validationsByServer[server.id])}`}>
                    {getValidationLabel(validationsByServer[server.id])}
                  </span>
                  {validationsByServer[server.id]?.issues.length ? (
                    <span className="ai-text-xs ai-text-muted-foreground">
                      {validationsByServer[server.id].issues.length} issue(s)
                    </span>
                  ) : null}
                </div>

                <div className="ai-detail-header">
                  <div className="ai-grid ai-gap-2">
                    <button
                      className="ai-card-title-button"
                      onClick={() => setSelectedServerId(server.id)}
                      type="button"
                    >
                      {server.name}
                    </button>
                    <span className="ai-text-sm ai-text-muted-foreground">{server.command}</span>
                  </div>
                  <span className={`ai-badge ${server.enabled ? 'ai-badge-success' : 'ai-badge-neutral'}`}>
                    {server.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>

                <div className="ai-pill-row">
                  {appOptions.map((app) =>
                    server.syncApps[app.id] ? (
                      <span className="ai-badge ai-badge-active" key={app.id}>
                        {app.label}
                      </span>
                    ) : null,
                  )}
                </div>

                <div className="ai-text-sm ai-text-muted-foreground">
                  {server.args.length ? server.args.join(' ') : 'No args'}
                </div>

                <div className="ai-detail-actions">
                  <button
                    className="ai-button ai-button-secondary"
                    onClick={() => {
                      setSelectedServerId(server.id);
                      setDraft(createDraft(server));
                    }}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="ai-button ai-button-danger"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(server.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="ai-provider-detail-card ai-grid ai-gap-4">
          {draft ? (
            <>
              <div className="ai-grid ai-gap-2">
                <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">
                  {draft.id ? 'Edit MCP Server' : 'Create MCP Server'}
                </h3>
                <p className="ai-text-sm ai-text-muted-foreground">
                  Args 和 Env 采用逐行格式，Env 使用 KEY=VALUE。
                </p>
              </div>

              <div className="ai-form-grid">
                <label className="ai-field">
                  <span className="ai-field-label">Name</span>
                  <input
                    className="ai-input"
                    onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                    value={draft.name}
                  />
                </label>
                <label className="ai-field">
                  <span className="ai-field-label">Command</span>
                  <input
                    className="ai-input"
                    onChange={(event) =>
                      setDraft((current) => (current ? { ...current, command: event.target.value } : current))
                    }
                    value={draft.command}
                  />
                </label>
                <label className="ai-field ai-field-span-2">
                  <span className="ai-field-label">Args</span>
                  <textarea
                    className="ai-input ai-textarea"
                    onChange={(event) => setDraft((current) => (current ? { ...current, args: event.target.value } : current))}
                    rows={5}
                    value={draft.args}
                  />
                </label>
                <label className="ai-field ai-field-span-2">
                  <span className="ai-field-label">Env</span>
                  <textarea
                    className="ai-input ai-textarea"
                    onChange={(event) => setDraft((current) => (current ? { ...current, env: event.target.value } : current))}
                    rows={6}
                    value={draft.env}
                  />
                </label>
                <div className="ai-field ai-field-span-2">
                  <span className="ai-field-label">Sync Targets</span>
                  <div className="ai-checkbox-row">
                    {appOptions.map((app) => (
                      <label className="ai-checkbox-chip" key={app.id}>
                        <input
                          checked={draft.syncApps[app.id]}
                          onChange={(event) =>
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    syncApps: { ...current.syncApps, [app.id]: event.target.checked },
                                  }
                                : current,
                            )
                          }
                          type="checkbox"
                        />
                        <span>{app.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <label className="ai-checkbox-chip">
                  <input
                    checked={draft.enabled}
                    onChange={(event) =>
                      setDraft((current) => (current ? { ...current, enabled: event.target.checked } : current))
                    }
                    type="checkbox"
                  />
                  <span>Enabled</span>
                </label>
              </div>

              <div className="ai-detail-actions">
                <button
                  className="ai-button ai-button-primary"
                  disabled={saveMutation.isPending || !draft.name.trim() || !draft.command.trim()}
                  onClick={() => saveMutation.mutate(toRecord(draft))}
                  type="button"
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save Server'}
                </button>
                <button className="ai-button ai-button-secondary" onClick={() => setDraft(null)} type="button">
                  Cancel
                </button>
              </div>
            </>
          ) : selectedServer ? (
            <>
              <div className="ai-detail-header">
                <div className="ai-grid ai-gap-2">
                  <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">{selectedServer.name}</h3>
                  <span className="ai-text-sm ai-text-muted-foreground">{selectedServer.command}</span>
                </div>
                <span className={`ai-badge ${selectedServer.enabled ? 'ai-badge-success' : 'ai-badge-neutral'}`}>
                  {selectedServer.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>

              <div className="ai-detail-grid">
                <div className="ai-detail-item">
                  <span className="ai-field-label">Args</span>
                  <span className="ai-detail-value">
                    {selectedServer.args.length ? selectedServer.args.join(' ') : 'No args configured'}
                  </span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Environment</span>
                  <span className="ai-detail-value">
                    {Object.keys(selectedServer.env).length
                      ? Object.entries(selectedServer.env)
                          .map(([key, value]) => `${key}=${value}`)
                          .join(', ')
                      : 'No env overrides'}
                  </span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Sync Targets</span>
                  <span className="ai-detail-value">
                    {appOptions.filter((app) => selectedServer.syncApps[app.id]).map((app) => app.label).join(', ') ||
                      'No targets'}
                  </span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Storage Source</span>
                  <span className="ai-detail-value">{data?.source ?? 'unknown'}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Validation</span>
                  <span className="ai-detail-value">{getValidationLabel(selectedValidation)}</span>
                </div>
              </div>

              {selectedValidation?.issues.length ? (
                <div className="ai-detail-note">
                  {selectedValidation.issues.map((issue) => issue).join(' · ')}
                </div>
              ) : null}

              <div className="ai-detail-actions">
                <button
                  className="ai-button ai-button-secondary"
                  onClick={() => setDraft(createDraft(selectedServer))}
                  type="button"
                >
                  Edit
                </button>
                <button
                  className="ai-button ai-button-primary"
                  disabled={syncMutation.isPending}
                  onClick={() => syncMutation.mutate()}
                  type="button"
                >
                  Sync Now
                </button>
              </div>

              <div className="ai-grid ai-gap-3">
                <div className="ai-history-header">
                  <div className="ai-grid ai-gap-1">
                    <h4 className="ai-text-base ai-font-semibold ai-text-card-foreground">Target Status</h4>
                    <span className="ai-text-sm ai-text-muted-foreground">当前选中 server 涉及的落盘目标。</span>
                  </div>
                </div>
                <div className="ai-grid ai-gap-3">
                  {selectedSyncStatuses.map((status) => (
                    <div className="ai-detail-item" key={status.app}>
                      <div className="ai-detail-header">
                        <strong className="ai-text-card-foreground">{formatAppLabel(status.app)}</strong>
                        <span className={`ai-badge ${getSyncTone(status.status)}`}>{status.status}</span>
                      </div>
                      <span className="ai-detail-value">{status.message}</span>
                      <span className="ai-text-sm ai-text-muted-foreground">{status.configPath}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="ai-detail-empty ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Starter Templates</h3>
              <p className="ai-text-sm ai-text-muted-foreground">从模板创建后会立即进入编辑状态。</p>
            </div>
          )}

          <div className="ai-grid ai-gap-3">
            <div className="ai-history-header">
              <div className="ai-grid ai-gap-1">
                <h4 className="ai-text-base ai-font-semibold ai-text-card-foreground">Templates</h4>
                <span className="ai-text-sm ai-text-muted-foreground">复用 legacy 模板清单作为起点。</span>
              </div>
            </div>
            <div className="ai-grid ai-gap-3">
              {(data?.templates ?? []).map((template) => (
                <div className="ai-detail-item" key={template.id}>
                  <div className="ai-detail-header">
                    <div className="ai-grid ai-gap-1">
                      <strong className="ai-text-card-foreground">{template.name}</strong>
                      <span className="ai-text-sm ai-text-muted-foreground">{template.command}</span>
                    </div>
                    <button
                      className="ai-button ai-button-secondary"
                      onClick={() => setDraft(createTemplateDraft(template))}
                      type="button"
                    >
                      Use
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}