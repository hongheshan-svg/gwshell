import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  type OpenClawEditableConfigRecord,
  saveAiPlatformOpenClawConfig,
} from '../../infra/commands/openclaw';
import { useAiPlatformOpenClaw } from '../../infra/query/useAiPlatformOpenClaw';

function cloneConfig(config: OpenClawEditableConfigRecord): OpenClawEditableConfigRecord {
  return JSON.parse(JSON.stringify(config)) as OpenClawEditableConfigRecord;
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(items: string[]) {
  return items.join('\n');
}

export function OpenClawPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useAiPlatformOpenClaw();
  const [draft, setDraft] = useState<OpenClawEditableConfigRecord | null>(null);
  const [allowInput, setAllowInput] = useState('');
  const [denyInput, setDenyInput] = useState('');
  const [fallbackInput, setFallbackInput] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!data) {
      return;
    }
    setDraft(cloneConfig(data.config));
    setAllowInput(joinLines(data.config.allowList));
    setDenyInput(joinLines(data.config.denyList));
    setFallbackInput(joinLines(data.config.fallbackModels));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (config: OpenClawEditableConfigRecord) => saveAiPlatformOpenClawConfig(config),
    onSuccess: async (snapshot) => {
      setDraft(cloneConfig(snapshot.config));
      setAllowInput(joinLines(snapshot.config.allowList));
      setDenyInput(joinLines(snapshot.config.denyList));
      setFallbackInput(joinLines(snapshot.config.fallbackModels));
      setMessage('OpenClaw 配置已保存。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'openclaw'] });
    },
    onError: (saveError) => {
      setMessage(String(saveError));
    },
  });

  const stats = useMemo(() => ({
    models: data?.providerOptions.length ?? 0,
    warnings: (data?.health ?? []).filter((item) => item.level === 'warning' || item.level === 'danger').length,
    activeProviders: (data?.providerOptions ?? []).filter((item) => item.active).length,
  }), [data?.health, data?.providerOptions]);

  function updateDraft(updater: (current: OpenClawEditableConfigRecord) => OpenClawEditableConfigRecord) {
    setDraft((current) => (current ? updater(current) : current));
    setMessage(null);
  }

  if (isLoading || !draft) {
    return <div className="ai-inline-message">正在加载 OpenClaw 配置...</div>;
  }

  return (
    <div className="ai-grid ai-gap-6">
      <section className="ai-grid ai-gap-4">
        <div className="ai-section-header">
          <div className="ai-grid ai-gap-2">
            <span className="ai-text-xs ai-uppercase ai-tracking-[0.18em] ai-text-muted-foreground">
              Domain / OpenClaw
            </span>
            <div className="ai-grid ai-gap-2">
              <h2 className="ai-text-2xl ai-font-semibold ai-text-card-foreground">OpenClaw Config Console</h2>
              <p className="ai-text-sm ai-text-muted-foreground ai-max-w-2xl">
                直接管理 OpenClaw 配置文件中的 env、tools 和 agents.defaults，并结合当前 OpenClaw providers 给出默认模型与健康提示。
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
                setAllowInput(joinLines(data.config.allowList));
                setDenyInput(joinLines(data.config.denyList));
                setFallbackInput(joinLines(data.config.fallbackModels));
                setMessage('已恢复到最近一次读取的 OpenClaw 配置。');
              }}
              type="button"
            >
              Reset
            </button>
            <button
              className="ai-button ai-button-primary"
              disabled={saveMutation.isPending}
              onClick={() =>
                saveMutation.mutate({
                  ...draft,
                  allowList: splitLines(allowInput),
                  denyList: splitLines(denyInput),
                  fallbackModels: splitLines(fallbackInput),
                })
              }
              type="button"
            >
              {saveMutation.isPending ? 'Saving...' : 'Save OpenClaw Config'}
            </button>
          </div>
        </div>

        <div className="ai-stats-grid">
          <article className="ai-stat-card">
            <span className="ai-stat-label">Provider Models</span>
            <span className="ai-stat-value">{stats.models}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Warnings</span>
            <span className="ai-stat-value">{stats.warnings}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Active Providers</span>
            <span className="ai-stat-value">{stats.activeProviders}</span>
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
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Env</h3>
              <p className="ai-text-sm ai-text-muted-foreground">以 JSON 形式编辑整个 env 节点，适合管理 API Key、自定义变量和 shellEnv。</p>
            </div>
            <textarea
              className="ai-input ai-editor"
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  envJson: event.target.value,
                }))
              }
              spellCheck={false}
              value={draft.envJson}
            />
          </article>

          <article className="ai-provider-card ai-grid ai-gap-4">
            <div className="ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Tools</h3>
              <p className="ai-text-sm ai-text-muted-foreground">控制 tools.profile 以及 allow 和 deny 列表。</p>
            </div>
            <div className="ai-form-grid">
              <label className="ai-field ai-field-span-2">
                <span className="ai-field-label">Tools Profile</span>
                <select
                  className="ai-input"
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      toolsProfile: event.target.value,
                    }))
                  }
                  value={draft.toolsProfile}
                >
                  <option value="">Unset</option>
                  <option value="minimal">minimal</option>
                  <option value="coding">coding</option>
                  <option value="messaging">messaging</option>
                  <option value="full">full</option>
                </select>
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Allow List</span>
                <textarea
                  className="ai-input ai-textarea"
                  onChange={(event) => setAllowInput(event.target.value)}
                  placeholder="write_file\nread_file"
                  spellCheck={false}
                  value={allowInput}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Deny List</span>
                <textarea
                  className="ai-input ai-textarea"
                  onChange={(event) => setDenyInput(event.target.value)}
                  placeholder="rm\ndel"
                  spellCheck={false}
                  value={denyInput}
                />
              </label>
            </div>
          </article>

          <article className="ai-provider-card ai-grid ai-gap-4">
            <div className="ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Agents Defaults</h3>
              <p className="ai-text-sm ai-text-muted-foreground">从已配置 provider 模型中设置默认模型，并管理运行时参数。</p>
            </div>
            <div className="ai-form-grid">
              <label className="ai-field ai-field-span-2">
                <span className="ai-field-label">Primary Model</span>
                <select
                  className="ai-input"
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      primaryModel: event.target.value,
                    }))
                  }
                  value={draft.primaryModel}
                >
                  <option value="">Unset</option>
                  {(data?.providerOptions ?? []).map((option) => (
                    <option key={`${option.providerId}:${option.model}`} value={option.model}>
                      {option.providerName} / {option.model}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ai-field ai-field-span-2">
                <span className="ai-field-label">Fallback Models</span>
                <textarea
                  className="ai-input ai-textarea"
                  onChange={(event) => setFallbackInput(event.target.value)}
                  placeholder="gpt-4.1\nclaude-sonnet-4"
                  spellCheck={false}
                  value={fallbackInput}
                />
              </label>
              <label className="ai-field ai-field-span-2">
                <span className="ai-field-label">Workspace</span>
                <input
                  className="ai-input"
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      workspace: event.target.value,
                    }))
                  }
                  placeholder="D:/workspace/project"
                  value={draft.workspace}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Timeout Seconds</span>
                <input
                  className="ai-input"
                  min={1}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      timeoutSeconds: Number(event.target.value) || undefined,
                    }))
                  }
                  type="number"
                  value={draft.timeoutSeconds ?? ''}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Context Tokens</span>
                <input
                  className="ai-input"
                  min={1}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      contextTokens: Number(event.target.value) || undefined,
                    }))
                  }
                  type="number"
                  value={draft.contextTokens ?? ''}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Max Concurrent</span>
                <input
                  className="ai-input"
                  min={1}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      maxConcurrent: Number(event.target.value) || undefined,
                    }))
                  }
                  type="number"
                  value={draft.maxConcurrent ?? ''}
                />
              </label>
            </div>
          </article>
        </div>

        <aside className="ai-provider-detail-card ai-grid ai-gap-4">
          <div className="ai-grid ai-gap-2">
            <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Health & Bridge</h3>
            <p className="ai-text-sm ai-text-muted-foreground">展示当前配置文件路径、provider 桥接摘要和结构化健康检查。</p>
          </div>

          <div className="ai-detail-item">
            <span className="ai-field-label">Config Path</span>
            <span className="ai-detail-value">{data?.configPath}</span>
          </div>
          <div className="ai-detail-item">
            <span className="ai-field-label">Bridge Summary</span>
            <span className="ai-detail-value">{data?.bridgeSummary}</span>
          </div>

          <div className="ai-detail-history-list">
            {(data?.health ?? []).map((item) => (
              <article className="ai-detail-item" key={item.id}>
                <div className="ai-detail-header">
                  <span className="ai-text-base ai-font-medium ai-text-card-foreground">{item.title}</span>
                  <span
                    className={`ai-badge ${
                      item.level === 'success'
                        ? 'ai-badge-success'
                        : item.level === 'warning'
                          ? 'ai-badge-warning'
                          : item.level === 'danger'
                            ? 'ai-badge-danger'
                            : 'ai-badge-neutral'
                    }`}
                  >
                    {item.level}
                  </span>
                </div>
                <div className="ai-detail-value">{item.detail}</div>
              </article>
            ))}
          </div>

          <div className="ai-detail-item">
            <span className="ai-field-label">Provider Models</span>
            <div className="ai-detail-history-list">
              {(data?.providerOptions ?? []).length === 0 ? (
                <div className="ai-detail-value">No OpenClaw provider models.</div>
              ) : (
                (data?.providerOptions ?? []).map((option) => (
                  <div className="ai-detail-item" key={`${option.providerId}:${option.model}`}>
                    <div className="ai-detail-header">
                      <span className="ai-text-sm ai-font-medium ai-text-card-foreground">
                        {option.providerName}
                      </span>
                      <span className={`ai-badge ${option.active ? 'ai-badge-success' : 'ai-badge-neutral'}`}>
                        {option.active ? 'Active' : 'Available'}
                      </span>
                    </div>
                    <div className="ai-detail-value">{option.model}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="ai-detail-note">Source: {data?.source}</div>
        </aside>
      </section>
    </div>
  );
}