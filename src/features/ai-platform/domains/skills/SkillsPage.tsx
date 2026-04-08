import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  addAiPlatformSkillRoot,
  removeAiPlatformSkillRoot,
  setAiPlatformSkillEnabled,
} from '../../infra/commands/skills';
import { useAiPlatformSkills } from '../../infra/query/useAiPlatformSkills';

export function SkillsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useAiPlatformSkills();
  const [rootPath, setRootPath] = useState('');
  const [search, setSearch] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const skills = data?.skills ?? [];
  const roots = data?.roots ?? [];

  const filteredSkills = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const sorted = [...skills].sort((left, right) => {
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    if (!keyword) {
      return sorted;
    }

    return sorted.filter((skill) => {
      const haystack = [skill.name, skill.description, skill.path].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [search, skills]);

  const selectedSkill = useMemo(
    () => filteredSkills.find((skill) => skill.id === selectedSkillId) ?? filteredSkills[0],
    [filteredSkills, selectedSkillId],
  );

  const addRootMutation = useMutation({
    mutationFn: addAiPlatformSkillRoot,
    onSuccess: async () => {
      setMessage('Skills root 已添加并完成扫描。');
      setRootPath('');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'skills'] });
    },
  });

  const removeRootMutation = useMutation({
    mutationFn: removeAiPlatformSkillRoot,
    onSuccess: async () => {
      setMessage('Skills root 已移除。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'skills'] });
    },
  });

  const toggleSkillMutation = useMutation({
    mutationFn: ({ skillId, enabled }: { skillId: string; enabled: boolean }) =>
      setAiPlatformSkillEnabled(skillId, enabled),
    onSuccess: async (_, variables) => {
      setMessage(variables.enabled ? 'Skill 已启用。' : 'Skill 已禁用。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'skills'] });
    },
  });

  const enabledCount = skills.filter((skill) => skill.enabled).length;

  return (
    <div className="ai-grid ai-gap-6">
      <section className="ai-grid ai-gap-4">
        <div className="ai-section-header">
          <div className="ai-grid ai-gap-2">
            <span className="ai-text-xs ai-uppercase ai-tracking-[0.18em] ai-text-muted-foreground">
              Domain / Skills
            </span>
            <div className="ai-grid ai-gap-2">
              <h2 className="ai-text-2xl ai-font-semibold ai-text-card-foreground">Skills Inventory</h2>
              <p className="ai-text-sm ai-text-muted-foreground ai-max-w-2xl">
                管理一个或多个技能根目录，自动发现包含 SKILL.md 的技能，并维护启用/禁用状态。
              </p>
            </div>
          </div>
          <div className="ai-flex ai-wrap ai-gap-3">
            <button
              className="ai-button ai-button-primary"
              disabled={addRootMutation.isPending || !rootPath.trim()}
              onClick={() => addRootMutation.mutate(rootPath.trim())}
              type="button"
            >
              {addRootMutation.isPending ? 'Scanning...' : 'Add Root'}
            </button>
          </div>
        </div>

        <div className="ai-form-grid">
          <label className="ai-field ai-field-span-2">
            <span className="ai-field-label">Skills Root Path</span>
            <input
              className="ai-input"
              onChange={(event) => setRootPath(event.target.value)}
              placeholder="D:/workspace/skills or D:/repo/.github/skills"
              value={rootPath}
            />
          </label>
        </div>

        <div className="ai-stats-grid">
          <article className="ai-stat-card">
            <span className="ai-stat-label">Roots</span>
            <span className="ai-stat-value">{roots.length}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Skills</span>
            <span className="ai-stat-value">{skills.length}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Enabled</span>
            <span className="ai-stat-value">{enabledCount}</span>
          </article>
        </div>

        {message ? <div className="ai-inline-message">{message}</div> : null}
        {error ? <div className="ai-inline-message ai-inline-message-error">{String(error)}</div> : null}

        <div className="ai-grid ai-gap-3">
          {roots.map((root) => (
            <article className="ai-detail-item" key={root.id}>
              <div className="ai-detail-header">
                <div className="ai-grid ai-gap-1">
                  <strong className="ai-text-card-foreground">{root.label}</strong>
                  <span className="ai-text-sm ai-text-muted-foreground">{root.path}</span>
                </div>
                <button
                  className="ai-button ai-button-danger"
                  disabled={removeRootMutation.isPending}
                  onClick={() => removeRootMutation.mutate(root.id)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="ai-provider-workbench">
        <div className="ai-grid ai-gap-4">
          <div className="ai-field">
            <span className="ai-field-label">Search</span>
            <input
              className="ai-input"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by skill name, description, or path"
              value={search}
            />
          </div>

          {isLoading ? <div className="ai-inline-message">正在扫描 Skills...</div> : null}

          {filteredSkills.length === 0 && !isLoading ? (
            <article className="ai-provider-card ai-grid ai-gap-3">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">No skills found</h3>
              <p className="ai-text-sm ai-text-muted-foreground">
                先添加一个技能根目录，系统会递归扫描其中所有包含 SKILL.md 的目录。
              </p>
            </article>
          ) : null}

          <div className="ai-provider-grid">
            {filteredSkills.map((skill) => (
              <article
                className={`ai-provider-card ${selectedSkill?.id === skill.id ? 'selected' : ''}`}
                key={skill.id}
              >
                <div className="ai-detail-header">
                  <div className="ai-grid ai-gap-1">
                    <button className="ai-card-title-button" onClick={() => setSelectedSkillId(skill.id)} type="button">
                      {skill.name}
                    </button>
                    <span className="ai-text-sm ai-text-muted-foreground">{skill.path}</span>
                  </div>
                  <span className={`ai-badge ${skill.enabled ? 'ai-badge-success' : 'ai-badge-neutral'}`}>
                    {skill.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="ai-text-sm ai-text-muted-foreground">{skill.description}</p>
              </article>
            ))}
          </div>
        </div>

        <aside className="ai-provider-detail-card ai-grid ai-gap-4">
          {selectedSkill ? (
            <>
              <div className="ai-detail-header">
                <div className="ai-grid ai-gap-2">
                  <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">{selectedSkill.name}</h3>
                  <span className="ai-text-sm ai-text-muted-foreground">{selectedSkill.path}</span>
                </div>
                <span className={`ai-badge ${selectedSkill.enabled ? 'ai-badge-success' : 'ai-badge-neutral'}`}>
                  {selectedSkill.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>

              <div className="ai-detail-grid">
                <div className="ai-detail-item">
                  <span className="ai-field-label">Description</span>
                  <span className="ai-detail-value">{selectedSkill.description}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Skill File</span>
                  <span className="ai-detail-value">{selectedSkill.skillFile}</span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Root</span>
                  <span className="ai-detail-value">
                    {roots.find((root) => root.id === selectedSkill.rootId)?.label ?? selectedSkill.rootId}
                  </span>
                </div>
              </div>

              <div className="ai-detail-actions">
                <button
                  className={selectedSkill.enabled ? 'ai-button ai-button-danger' : 'ai-button ai-button-primary'}
                  disabled={toggleSkillMutation.isPending}
                  onClick={() =>
                    toggleSkillMutation.mutate({ skillId: selectedSkill.id, enabled: !selectedSkill.enabled })
                  }
                  type="button"
                >
                  {toggleSkillMutation.isPending
                    ? 'Updating...'
                    : selectedSkill.enabled
                      ? 'Disable Skill'
                      : 'Enable Skill'}
                </button>
              </div>
            </>
          ) : (
            <div className="ai-detail-empty ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Select a skill</h3>
              <p className="ai-text-sm ai-text-muted-foreground">左侧会列出所有扫描到的技能。</p>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}