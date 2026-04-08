import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteAiPlatformSessionRecord } from '../../infra/commands/sessions';
import { useAiPlatformSessions } from '../../infra/query/useAiPlatformSessions';

const sessionTypeOptions = ['all', 'ssh', 'sftp', 'localshell', 'docker', 'serial'] as const;
type SessionTypeFilter = (typeof sessionTypeOptions)[number];

export function SessionsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useAiPlatformSessions();
  const [filter, setFilter] = useState<SessionTypeFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deleteAiPlatformSessionRecord,
    onSuccess: async () => {
      setMessage('会话记录已删除。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'sessions'] });
    },
    onError: (deleteError) => {
      setMessage(String(deleteError));
    },
  });

  const sessions = data?.sessions ?? [];

  const filteredSessions = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return sessions.filter((session) => {
      if (filter !== 'all' && session.sessionType !== filter) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const haystack = [
        session.id,
        session.name,
        session.summary,
        session.target,
        session.projectDir ?? '',
        session.group ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [filter, search, sessions]);

  const selectedSession = useMemo(
    () => filteredSessions.find((session) => session.id === selectedSessionId) ?? filteredSessions[0],
    [filteredSessions, selectedSessionId],
  );

  useEffect(() => {
    if (!selectedSession) {
      return;
    }
    setSelectedSessionId(selectedSession.id);
  }, [selectedSession?.id]);

  const stats = useMemo(
    () => ({
      sessions: sessions.length,
      resumable: sessions.filter((session) => Boolean(session.resumeCommand)).length,
      groups: data?.groups.length ?? 0,
    }),
    [data?.groups.length, sessions],
  );

  async function copyText(value: string, successMessage: string) {
    await globalThis.navigator?.clipboard?.writeText(value);
    setMessage(successMessage);
  }

  return (
    <div className="ai-grid ai-gap-6">
      <section className="ai-grid ai-gap-4">
        <div className="ai-section-header">
          <div className="ai-grid ai-gap-2">
            <span className="ai-text-xs ai-uppercase ai-tracking-[0.18em] ai-text-muted-foreground">
              Domain / Sessions
            </span>
            <div className="ai-grid ai-gap-2">
              <h2 className="ai-text-2xl ai-font-semibold ai-text-card-foreground">Session Assets</h2>
              <p className="ai-text-sm ai-text-muted-foreground ai-max-w-2xl">
                读取当前应用已保存的会话资产，支持按类型筛选、生成恢复命令、删除记录，并提供一个可复制的 deeplink 草案模板。
              </p>
            </div>
          </div>
        </div>

        <div className="ai-stats-grid">
          <article className="ai-stat-card">
            <span className="ai-stat-label">Sessions</span>
            <span className="ai-stat-value">{stats.sessions}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Resumable</span>
            <span className="ai-stat-value">{stats.resumable}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Groups</span>
            <span className="ai-stat-value">{stats.groups}</span>
          </article>
        </div>

        {message ? (
          <div className={`ai-inline-message ${deleteMutation.isError || error ? 'ai-inline-message-error' : ''}`}>
            {message}
          </div>
        ) : null}
        {error ? <div className="ai-inline-message ai-inline-message-error">{String(error)}</div> : null}
      </section>

      <section className="ai-provider-workbench">
        <div className="ai-grid ai-gap-4">
          <div className="ai-form-grid">
            <label className="ai-field">
              <span className="ai-field-label">Type</span>
              <select className="ai-input" onChange={(event) => setFilter(event.target.value as SessionTypeFilter)} value={filter}>
                {sessionTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="ai-field">
              <span className="ai-field-label">Search</span>
              <input
                className="ai-input"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, target, directory, or session id"
                value={search}
              />
            </label>
          </div>

          {isLoading ? <div className="ai-inline-message">正在加载会话资产...</div> : null}

          <div className="ai-provider-grid">
            {filteredSessions.map((session) => (
              <article
                className={`ai-provider-card ${selectedSession?.id === session.id ? 'selected' : ''}`}
                key={session.id}
              >
                <div className="ai-detail-header">
                  <div className="ai-grid ai-gap-1">
                    <button className="ai-card-title-button" onClick={() => setSelectedSessionId(session.id)} type="button">
                      {session.name}
                    </button>
                    <span className="ai-text-sm ai-text-muted-foreground">{session.target}</span>
                  </div>
                  <span className={`ai-badge ${session.resumeCommand ? 'ai-badge-success' : 'ai-badge-neutral'}`}>
                    {session.sessionType}
                  </span>
                </div>
                <p className="ai-text-sm ai-text-muted-foreground">{session.summary}</p>
              </article>
            ))}
          </div>
        </div>

        <aside className="ai-provider-detail-card ai-grid ai-gap-4">
          {selectedSession ? (
            <>
              <div className="ai-detail-header">
                <div className="ai-grid ai-gap-2">
                  <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">{selectedSession.name}</h3>
                  <span className="ai-text-sm ai-text-muted-foreground">{selectedSession.id}</span>
                </div>
                <span className={`ai-badge ${selectedSession.resumeCommand ? 'ai-badge-success' : 'ai-badge-warning'}`}>
                  {selectedSession.resumeCommand ? 'Resumable' : 'Static'}
                </span>
              </div>

              <div className="ai-detail-grid">
                <div className="ai-detail-item">
                  <span className="ai-field-label">Target</span>
                  <span className="ai-detail-value">{selectedSession.target}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Summary</span>
                  <span className="ai-detail-value">{selectedSession.summary}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Project Dir</span>
                  <span className="ai-detail-value">{selectedSession.projectDir ?? 'N/A'}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Group</span>
                  <span className="ai-detail-value">{selectedSession.group ?? 'Ungrouped'}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Resume Command</span>
                  <span className="ai-detail-value">{selectedSession.resumeCommand ?? 'No generated command'}</span>
                </div>
              </div>

              <div className="ai-detail-actions">
                {selectedSession.resumeCommand ? (
                  <button
                    className="ai-button ai-button-primary"
                    onClick={() => void copyText(selectedSession.resumeCommand ?? '', '恢复命令已复制。')}
                    type="button"
                  >
                    Copy Resume Command
                  </button>
                ) : null}
                <button
                  className="ai-button ai-button-secondary"
                  onClick={() =>
                    void copyText(
                      data?.deeplinkTemplate
                        .replace('<id>', selectedSession.id)
                        .replace('<type>', selectedSession.sessionType) ?? '',
                      'deeplink 草案已复制。',
                    )
                  }
                  type="button"
                >
                  Copy Deeplink Draft
                </button>
                <button
                  className="ai-button ai-button-danger"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(selectedSession.id)}
                  type="button"
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete Session'}
                </button>
              </div>
            </>
          ) : (
            <div className="ai-detail-empty ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">No session selected</h3>
              <p className="ai-text-sm ai-text-muted-foreground">左侧会列出当前数据库中已保存的会话资产。</p>
            </div>
          )}

          <div className="ai-detail-item">
            <span className="ai-field-label">Session Groups</span>
            <div className="ai-detail-history-list">
              {(data?.groups ?? []).length === 0 ? (
                <div className="ai-detail-value">No saved groups.</div>
              ) : (
                (data?.groups ?? []).map((group) => (
                  <div className="ai-detail-item" key={group.name}>
                    <div className="ai-detail-header">
                      <span className="ai-text-sm ai-font-medium ai-text-card-foreground">{group.name}</span>
                      <span className="ai-badge ai-badge-neutral">{group.count}</span>
                    </div>
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