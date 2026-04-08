import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  saveAiPlatformAgentAssignment,
  setAiPlatformAgentEnabled,
  setAiPlatformAgentsRoutingMode,
} from '../../infra/commands/agents';
import { useAiPlatformAgents } from '../../infra/query/useAiPlatformAgents';

const routingModes = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'focused', label: 'Focused' },
  { id: 'parallel', label: 'Parallel' },
];

export function AgentsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useAiPlatformAgents();
  const [search, setSearch] = useState('');
  const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const agents = data?.agents ?? [];
  const categories = data?.categories ?? [];
  const providerOptions = data?.providerOptions ?? [];

  const filteredAgents = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const sorted = [...agents].sort((left, right) => left.name.localeCompare(right.name));
    if (!keyword) {
      return sorted;
    }
    return sorted.filter((agent) => {
      const haystack = [agent.name, agent.description, agent.category].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [agents, search]);

  const selectedAgent = useMemo(
    () => filteredAgents.find((agent) => agent.key === selectedAgentKey) ?? filteredAgents[0],
    [filteredAgents, selectedAgentKey],
  );

  const toggleMutation = useMutation({
    mutationFn: ({ agentKey, enabled }: { agentKey: string; enabled: boolean }) =>
      setAiPlatformAgentEnabled(agentKey, enabled),
    onSuccess: async (_, variables) => {
      setMessage(variables.enabled ? 'Agent 已启用。' : 'Agent 已禁用。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'agents'] });
    },
  });

  const assignmentMutation = useMutation({
    mutationFn: saveAiPlatformAgentAssignment,
    onSuccess: async () => {
      setMessage('Agent assignment 已保存。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'agents'] });
    },
  });

  const routingMutation = useMutation({
    mutationFn: setAiPlatformAgentsRoutingMode,
    onSuccess: async (_, routingMode) => {
      setMessage(`Routing mode 已切换为 ${routingMode}。`);
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'agents'] });
    },
  });

  const enabledCount = agents.filter((agent) => agent.enabled).length;

  return (
    <div className="ai-grid ai-gap-6">
      <section className="ai-grid ai-gap-4">
        <div className="ai-section-header">
          <div className="ai-grid ai-gap-2">
            <span className="ai-text-xs ai-uppercase ai-tracking-[0.18em] ai-text-muted-foreground">
              Domain / Agents
            </span>
            <div className="ai-grid ai-gap-2">
              <h2 className="ai-text-2xl ai-font-semibold ai-text-card-foreground">Agent Control Plane</h2>
              <p className="ai-text-sm ai-text-muted-foreground ai-max-w-2xl">
                管理 agent catalog、分类、启用状态以及和 openclaw provider/model 的默认槽位绑定。
              </p>
            </div>
          </div>
          <div className="ai-pill-row">
            {routingModes.map((mode) => (
              <button
                className={`ai-pill ${data?.routingMode === mode.id ? 'active' : ''}`}
                key={mode.id}
                onClick={() => routingMutation.mutate(mode.id)}
                type="button"
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        <div className="ai-stats-grid">
          <article className="ai-stat-card">
            <span className="ai-stat-label">Agents</span>
            <span className="ai-stat-value">{agents.length}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Enabled</span>
            <span className="ai-stat-value">{enabledCount}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Model Slots</span>
            <span className="ai-stat-value">{providerOptions.length}</span>
          </article>
        </div>

        {message ? <div className="ai-inline-message">{message}</div> : null}
        {error ? <div className="ai-inline-message ai-inline-message-error">{String(error)}</div> : null}
      </section>

      <section className="ai-provider-workbench">
        <div className="ai-grid ai-gap-4">
          <div className="ai-field">
            <span className="ai-field-label">Search</span>
            <input
              className="ai-input"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by agent, category, or description"
              value={search}
            />
          </div>

          {isLoading ? <div className="ai-inline-message">正在加载 Agents...</div> : null}

          <div className="ai-provider-grid">
            {filteredAgents.map((agent) => (
              <article
                className={`ai-provider-card ${selectedAgent?.key === agent.key ? 'selected' : ''}`}
                key={agent.key}
              >
                <div className="ai-detail-header">
                  <div className="ai-grid ai-gap-1">
                    <button className="ai-card-title-button" onClick={() => setSelectedAgentKey(agent.key)} type="button">
                      {agent.name}
                    </button>
                    <span className="ai-text-sm ai-text-muted-foreground">
                      {categories.find((category) => category.id === agent.category)?.name ?? agent.category}
                    </span>
                  </div>
                  <span className={`ai-badge ${agent.enabled ? 'ai-badge-success' : 'ai-badge-neutral'}`}>
                    {agent.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="ai-text-sm ai-text-muted-foreground">{agent.description}</p>
              </article>
            ))}
          </div>
        </div>

        <aside className="ai-provider-detail-card ai-grid ai-gap-4">
          {selectedAgent ? (
            <>
              <div className="ai-detail-header">
                <div className="ai-grid ai-gap-2">
                  <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">{selectedAgent.name}</h3>
                  <span className="ai-text-sm ai-text-muted-foreground">{selectedAgent.key}</span>
                </div>
                <span className={`ai-badge ${selectedAgent.enabled ? 'ai-badge-success' : 'ai-badge-neutral'}`}>
                  {selectedAgent.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>

              <div className="ai-detail-grid">
                <div className="ai-detail-item">
                  <span className="ai-field-label">Category</span>
                  <span className="ai-detail-value">
                    {categories.find((category) => category.id === selectedAgent.category)?.name ?? selectedAgent.category}
                  </span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Description</span>
                  <span className="ai-detail-value">{selectedAgent.description}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Provider Slot</span>
                  <select
                    className="ai-input"
                    onChange={(event) => {
                      const selected = providerOptions.find((option) => option.providerId === event.target.value);
                      assignmentMutation.mutate({
                        agentKey: selectedAgent.key,
                        providerId: selected?.providerId,
                        model: selected?.model,
                        timeoutSeconds: selectedAgent.assignment.timeoutSeconds,
                      });
                    }}
                    value={selectedAgent.assignment.providerId ?? ''}
                  >
                    <option value="">Unassigned</option>
                    {providerOptions.map((option) => (
                      <option key={option.providerId} value={option.providerId}>
                        {option.providerName} / {option.model}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Timeout</span>
                  <input
                    className="ai-input"
                    min={15}
                    onBlur={(event) => {
                      const timeoutSeconds = Number(event.target.value) || selectedAgent.assignment.timeoutSeconds || 60;
                      assignmentMutation.mutate({
                        ...selectedAgent.assignment,
                        timeoutSeconds,
                      });
                    }}
                    defaultValue={selectedAgent.assignment.timeoutSeconds ?? 60}
                    type="number"
                  />
                </div>
              </div>

              <div className="ai-detail-actions">
                <button
                  className={selectedAgent.enabled ? 'ai-button ai-button-danger' : 'ai-button ai-button-primary'}
                  disabled={toggleMutation.isPending}
                  onClick={() =>
                    toggleMutation.mutate({ agentKey: selectedAgent.key, enabled: !selectedAgent.enabled })
                  }
                  type="button"
                >
                  {toggleMutation.isPending
                    ? 'Updating...'
                    : selectedAgent.enabled
                      ? 'Disable Agent'
                      : 'Enable Agent'}
                </button>
              </div>
            </>
          ) : (
            <div className="ai-detail-empty ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Select an agent</h3>
              <p className="ai-text-sm ai-text-muted-foreground">左侧会列出当前 catalog 中的所有 agents。</p>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}