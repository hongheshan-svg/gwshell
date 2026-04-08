import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useAppStore } from '../../../../stores/appStore';
import type { Locale } from '../../../../i18n';
import {
  type AiPlatformSettingsRecord,
  saveAiPlatformSettings,
} from '../../infra/commands/settings';
import { useAiPlatformSettings } from '../../infra/query/useAiPlatformSettings';

function cloneSettings(settings: AiPlatformSettingsRecord): AiPlatformSettingsRecord {
  return JSON.parse(JSON.stringify(settings)) as AiPlatformSettingsRecord;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const locale = useAppStore((state) => state.locale);
  const setLocale = useAppStore((state) => state.setLocale);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const { data, isLoading, error } = useAiPlatformSettings();
  const [draft, setDraft] = useState<AiPlatformSettingsRecord | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!data) {
      return;
    }
    setDraft(cloneSettings(data.settings));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (settings: AiPlatformSettingsRecord) => saveAiPlatformSettings(settings),
    onSuccess: async (snapshot) => {
      setDraft(cloneSettings(snapshot.settings));
      setMessage('平台设置已保存。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'settings'] });
    },
    onError: (saveError) => {
      setMessage(String(saveError));
    },
  });

  const stats = useMemo(() => {
    const statuses = data?.statuses ?? [];
    return {
      success: statuses.filter((item) => item.level === 'success').length,
      warning: statuses.filter((item) => item.level === 'warning').length,
      enabled: [draft?.backup.enabled, draft?.webdav.enabled, Boolean(draft?.outboundProxy.url.trim())].filter(Boolean)
        .length,
    };
  }, [data?.statuses, draft?.backup.enabled, draft?.outboundProxy.url, draft?.webdav.enabled]);

  function updateDraft(updater: (current: AiPlatformSettingsRecord) => AiPlatformSettingsRecord) {
    setDraft((current) => (current ? updater(current) : current));
    setMessage(null);
  }

  if (isLoading || !draft) {
    return <div className="ai-inline-message">正在加载平台设置...</div>;
  }

  return (
    <div className="ai-grid ai-gap-6">
      <section className="ai-grid ai-gap-4">
        <div className="ai-section-header">
          <div className="ai-grid ai-gap-2">
            <span className="ai-text-xs ai-uppercase ai-tracking-[0.18em] ai-text-muted-foreground">
              Domain / Settings
            </span>
            <div className="ai-grid ai-gap-2">
              <h2 className="ai-text-2xl ai-font-semibold ai-text-card-foreground">AI Platform Settings</h2>
              <p className="ai-text-sm ai-text-muted-foreground ai-max-w-2xl">
                管理默认工作区、各 app 配置目录、主题语言、备份策略、WebDAV 与全局出站代理，并把结果持久化到平台设置中心。
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
                setDraft(cloneSettings(data.settings));
                setTheme(data.settings.appearance.theme);
                setLocale(data.settings.appearance.language as Locale);
                setMessage('已恢复到最近一次已保存的设置。');
              }}
              type="button"
            >
              Reset
            </button>
            <button
              className="ai-button ai-button-primary"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate(draft)}
              type="button"
            >
              {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>

        <div className="ai-stats-grid">
          <article className="ai-stat-card">
            <span className="ai-stat-label">Healthy</span>
            <span className="ai-stat-value">{stats.success}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Warnings</span>
            <span className="ai-stat-value">{stats.warning}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Enabled Controls</span>
            <span className="ai-stat-value">{stats.enabled}</span>
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
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Appearance</h3>
              <p className="ai-text-sm ai-text-muted-foreground">页面立即预览主题和语言，保存后进入平台设置持久化。</p>
            </div>
            <div className="ai-form-grid">
              <label className="ai-field">
                <span className="ai-field-label">Theme</span>
                <select
                  className="ai-input"
                  onChange={(event) => {
                    const value = event.target.value as 'dark' | 'light';
                    updateDraft((current) => ({
                      ...current,
                      appearance: { ...current.appearance, theme: value },
                    }));
                    setTheme(value);
                  }}
                  value={draft.appearance.theme}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Language</span>
                <select
                  className="ai-input"
                  onChange={(event) => {
                    const value = event.target.value as Locale;
                    updateDraft((current) => ({
                      ...current,
                      appearance: { ...current.appearance, language: value },
                    }));
                    setLocale(value);
                  }}
                  value={draft.appearance.language}
                >
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
            <div className="ai-detail-note">当前宿主主题: {theme} / 语言: {locale}</div>
          </article>

          <article className="ai-provider-card ai-grid ai-gap-4">
            <div className="ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Directories</h3>
              <p className="ai-text-sm ai-text-muted-foreground">为 Workspace、Prompts、MCP 和多 app 配置桥接保留统一入口。</p>
            </div>
            <div className="ai-form-grid">
              <label className="ai-field ai-field-span-2">
                <span className="ai-field-label">Default Workspace Root</span>
                <input
                  className="ai-input"
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      directories: { ...current.directories, defaultWorkspaceRoot: event.target.value },
                    }))
                  }
                  placeholder="D:/workspace/project"
                  value={draft.directories.defaultWorkspaceRoot}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Claude Config Dir</span>
                <input
                  className="ai-input"
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      directories: { ...current.directories, claudeConfigDir: event.target.value },
                    }))
                  }
                  placeholder="C:/Users/name/.claude"
                  value={draft.directories.claudeConfigDir}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Codex Config Dir</span>
                <input
                  className="ai-input"
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      directories: { ...current.directories, codexConfigDir: event.target.value },
                    }))
                  }
                  placeholder="C:/Users/name/.codex"
                  value={draft.directories.codexConfigDir}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Gemini Config Dir</span>
                <input
                  className="ai-input"
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      directories: { ...current.directories, geminiConfigDir: event.target.value },
                    }))
                  }
                  placeholder="C:/Users/name/.gemini"
                  value={draft.directories.geminiConfigDir}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">OpenCode Config Dir</span>
                <input
                  className="ai-input"
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      directories: { ...current.directories, opencodeConfigDir: event.target.value },
                    }))
                  }
                  placeholder="C:/Users/name/.opencode"
                  value={draft.directories.opencodeConfigDir}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">OpenClaw Config Dir</span>
                <input
                  className="ai-input"
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      directories: { ...current.directories, openclawConfigDir: event.target.value },
                    }))
                  }
                  placeholder="C:/Users/name/.openclaw"
                  value={draft.directories.openclawConfigDir}
                />
              </label>
            </div>
          </article>

          <article className="ai-provider-card ai-grid ai-gap-4">
            <div className="ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Backup & Sync</h3>
              <p className="ai-text-sm ai-text-muted-foreground">先保存策略参数，后续可以直接接入真正的备份执行器与 WebDAV 任务。</p>
            </div>
            <div className="ai-form-grid">
              <label className="ai-checkbox-chip">
                <input
                  checked={draft.backup.enabled}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      backup: { ...current.backup, enabled: event.target.checked },
                    }))
                  }
                  type="checkbox"
                />
                Auto Backup
              </label>
              <label className="ai-checkbox-chip">
                <input
                  checked={draft.webdav.enabled}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      webdav: { ...current.webdav, enabled: event.target.checked },
                    }))
                  }
                  type="checkbox"
                />
                WebDAV Enabled
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Backup Interval Hours</span>
                <input
                  className="ai-input"
                  min={1}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      backup: { ...current.backup, intervalHours: Number(event.target.value) || 1 },
                    }))
                  }
                  type="number"
                  value={draft.backup.intervalHours}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">Retention Count</span>
                <input
                  className="ai-input"
                  min={1}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      backup: { ...current.backup, retentionCount: Number(event.target.value) || 1 },
                    }))
                  }
                  type="number"
                  value={draft.backup.retentionCount}
                />
              </label>
              <label className="ai-field ai-field-span-2">
                <span className="ai-field-label">WebDAV Base URL</span>
                <input
                  className="ai-input"
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      webdav: { ...current.webdav, baseUrl: event.target.value },
                    }))
                  }
                  placeholder="https://dav.example.com"
                  value={draft.webdav.baseUrl}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">WebDAV Username</span>
                <input
                  className="ai-input"
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      webdav: { ...current.webdav, username: event.target.value },
                    }))
                  }
                  value={draft.webdav.username}
                />
              </label>
              <label className="ai-field">
                <span className="ai-field-label">WebDAV Password</span>
                <input
                  className="ai-input"
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      webdav: { ...current.webdav, password: event.target.value },
                    }))
                  }
                  type="password"
                  value={draft.webdav.password}
                />
              </label>
              <label className="ai-field ai-field-span-2">
                <span className="ai-field-label">Remote Path</span>
                <input
                  className="ai-input"
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      webdav: { ...current.webdav, remotePath: event.target.value },
                    }))
                  }
                  value={draft.webdav.remotePath}
                />
              </label>
              <label className="ai-checkbox-chip ai-field-span-2">
                <input
                  checked={draft.webdav.autoSync}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      webdav: { ...current.webdav, autoSync: event.target.checked },
                    }))
                  }
                  type="checkbox"
                />
                Auto sync to WebDAV after future data mutations
              </label>
            </div>
          </article>

          <article className="ai-provider-card ai-grid ai-gap-4">
            <div className="ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Outbound Proxy</h3>
              <p className="ai-text-sm ai-text-muted-foreground">供后续 provider 健康检查、技能下载和 WebDAV 等网络操作复用。</p>
            </div>
            <label className="ai-field">
              <span className="ai-field-label">Proxy URL</span>
              <input
                className="ai-input"
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    outboundProxy: { url: event.target.value },
                  }))
                }
                placeholder="http://127.0.0.1:7890"
                value={draft.outboundProxy.url}
              />
            </label>
          </article>
        </div>

        <aside className="ai-provider-detail-card ai-grid ai-gap-4">
          <div className="ai-grid ai-gap-2">
            <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Status</h3>
            <p className="ai-text-sm ai-text-muted-foreground">这里显示各关键设置项的即时状态，便于后续接入真正执行器前先完成参数治理。</p>
          </div>

          <div className="ai-detail-history-list">
            {(data?.statuses ?? []).map((item) => (
              <article className="ai-detail-item" key={item.id}>
                <div className="ai-detail-header">
                  <span className="ai-text-base ai-font-medium ai-text-card-foreground">{item.label}</span>
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

          <div className="ai-detail-note">Source: {data?.source}</div>
        </aside>
      </section>
    </div>
  );
}