import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  createAiPlatformDailyMemory,
  deleteAiPlatformWorkspaceFile,
  writeAiPlatformWorkspaceFile,
} from '../../infra/commands/workspace';
import { useAiPlatformSettings } from '../../infra/query/useAiPlatformSettings';
import { useAiPlatformWorkspace } from '../../infra/query/useAiPlatformWorkspace';

const workspaceRootStorageKey = 'ai-platform.workspace.root';

export function WorkspacePage() {
  const queryClient = useQueryClient();
  const [workspaceRootInput, setWorkspaceRootInput] = useState('');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const settingsQuery = useAiPlatformSettings();
  const { data, isLoading, error } = useAiPlatformWorkspace(workspaceRoot);

  useEffect(() => {
    const saved = globalThis.localStorage?.getItem(workspaceRootStorageKey) ?? '';
    if (saved) {
      setWorkspaceRootInput(saved);
      setWorkspaceRoot(saved);
    }
  }, []);

  useEffect(() => {
    if (workspaceRoot) {
      globalThis.localStorage?.setItem(workspaceRootStorageKey, workspaceRoot);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    if (workspaceRoot) {
      return;
    }
    const configuredRoot = settingsQuery.data?.settings.directories.defaultWorkspaceRoot?.trim() ?? '';
    if (!configuredRoot) {
      return;
    }
    setWorkspaceRootInput(configuredRoot);
    setWorkspaceRoot(configuredRoot);
  }, [settingsQuery.data?.settings.directories.defaultWorkspaceRoot, workspaceRoot]);

  const files = data?.files ?? [];
  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedFileId) ?? files[0],
    [files, selectedFileId],
  );

  useEffect(() => {
    if (!selectedFile) {
      return;
    }
    setSelectedFileId(selectedFile.id);
    setEditorContent(selectedFile.content);
  }, [selectedFile?.id, selectedFile?.content]);

  const saveMutation = useMutation({
    mutationFn: ({ filePath, content }: { filePath: string; content: string }) =>
      writeAiPlatformWorkspaceFile(filePath, content),
    onSuccess: async () => {
      setMessage('Workspace 文件已保存。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'workspace', workspaceRoot] });
    },
  });

  const createDailyMemoryMutation = useMutation({
    mutationFn: () => createAiPlatformDailyMemory(workspaceRoot),
    onSuccess: async () => {
      setMessage('今日 daily memory 已创建。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'workspace', workspaceRoot] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (filePath: string) => deleteAiPlatformWorkspaceFile(workspaceRoot, filePath),
    onSuccess: async () => {
      setMessage('文件已删除。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'workspace', workspaceRoot] });
    },
  });

  const dailyMemoryCount = files.filter((file) => file.kind === 'daily-memory').length;
  const existingCount = files.filter((file) => file.exists).length;

  return (
    <div className="ai-grid ai-gap-6">
      <section className="ai-grid ai-gap-4">
        <div className="ai-section-header">
          <div className="ai-grid ai-gap-2">
            <span className="ai-text-xs ai-uppercase ai-tracking-[0.18em] ai-text-muted-foreground">
              Domain / Workspace
            </span>
            <div className="ai-grid ai-gap-2">
              <h2 className="ai-text-2xl ai-font-semibold ai-text-card-foreground">Workspace Files</h2>
              <p className="ai-text-sm ai-text-muted-foreground ai-max-w-2xl">
                统一查看并编辑工作区内的关键 instruction 文件，以及 `.ai-platform/daily-memory` 下的 daily memory 记录。
              </p>
            </div>
          </div>
          <div className="ai-flex ai-wrap ai-gap-3">
            <button
              className="ai-button ai-button-secondary"
              disabled={!settingsQuery.data?.settings.directories.defaultWorkspaceRoot}
              onClick={() => {
                const configuredRoot = settingsQuery.data?.settings.directories.defaultWorkspaceRoot?.trim() ?? '';
                if (!configuredRoot) {
                  return;
                }
                setWorkspaceRootInput(configuredRoot);
                setWorkspaceRoot(configuredRoot);
                setMessage('已切换到 Settings 中的默认工作区。');
              }}
              type="button"
            >
              Use Default Root
            </button>
            <button
              className="ai-button ai-button-secondary"
              onClick={() => {
                setWorkspaceRoot(workspaceRootInput.trim());
                setMessage(null);
              }}
              type="button"
            >
              Load Workspace
            </button>
            <button
              className="ai-button ai-button-primary"
              disabled={createDailyMemoryMutation.isPending || !workspaceRoot}
              onClick={() => createDailyMemoryMutation.mutate()}
              type="button"
            >
              {createDailyMemoryMutation.isPending ? 'Creating...' : 'Add Daily Memory'}
            </button>
          </div>
        </div>

        <div className="ai-form-grid">
          <label className="ai-field ai-field-span-2">
            <span className="ai-field-label">Workspace Root</span>
            <input
              className="ai-input"
              onChange={(event) => setWorkspaceRootInput(event.target.value)}
              placeholder="D:/workspace/project"
              value={workspaceRootInput}
            />
          </label>
        </div>

        <div className="ai-stats-grid">
          <article className="ai-stat-card">
            <span className="ai-stat-label">Files</span>
            <span className="ai-stat-value">{files.length}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Existing</span>
            <span className="ai-stat-value">{existingCount}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Daily Memory</span>
            <span className="ai-stat-value">{dailyMemoryCount}</span>
          </article>
        </div>

        {message ? <div className="ai-inline-message">{message}</div> : null}
        {error ? <div className="ai-inline-message ai-inline-message-error">{String(error)}</div> : null}
      </section>

      <section className="ai-provider-workbench">
        <div className="ai-grid ai-gap-4">
          {!workspaceRoot ? (
            <article className="ai-provider-card ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Select a workspace root</h3>
              <p className="ai-text-sm ai-text-muted-foreground">先加载工作区路径，再浏览指令文件和 daily memory。</p>
            </article>
          ) : null}

          {isLoading ? <div className="ai-inline-message">正在加载 Workspace 文件...</div> : null}

          <div className="ai-provider-grid">
            {files.map((file) => (
              <article
                className={`ai-provider-card ${selectedFile?.id === file.id ? 'selected' : ''}`}
                key={file.id}
              >
                <div className="ai-detail-header">
                  <div className="ai-grid ai-gap-1">
                    <button className="ai-card-title-button" onClick={() => setSelectedFileId(file.id)} type="button">
                      {file.title}
                    </button>
                    <span className="ai-text-sm ai-text-muted-foreground">{file.kind}</span>
                  </div>
                  <span className={`ai-badge ${file.exists ? 'ai-badge-success' : 'ai-badge-neutral'}`}>
                    {file.exists ? 'Present' : 'Missing'}
                  </span>
                </div>
                <div className="ai-detail-item">
                  <span className="ai-field-label">Path</span>
                  <span className="ai-detail-value">{file.path}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="ai-provider-detail-card ai-grid ai-gap-4">
          {selectedFile ? (
            <>
              <div className="ai-detail-header">
                <div className="ai-grid ai-gap-2">
                  <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">{selectedFile.title}</h3>
                  <span className="ai-text-sm ai-text-muted-foreground">{selectedFile.path}</span>
                </div>
                <span className={`ai-badge ${selectedFile.exists ? 'ai-badge-success' : 'ai-badge-warning'}`}>
                  {selectedFile.exists ? 'Editable' : 'Will Create'}
                </span>
              </div>

              <div className="ai-detail-actions">
                <button
                  className="ai-button ai-button-primary"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate({ filePath: selectedFile.path, content: editorContent })}
                  type="button"
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save'}
                </button>
                {selectedFile.kind === 'daily-memory' ? (
                  <button
                    className="ai-button ai-button-danger"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(selectedFile.path)}
                    type="button"
                  >
                    {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                  </button>
                ) : null}
              </div>

              <textarea
                className="ai-input ai-editor"
                onChange={(event) => setEditorContent(event.target.value)}
                spellCheck={false}
                value={editorContent}
              />
            </>
          ) : (
            <div className="ai-detail-empty ai-grid ai-gap-2">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">No file selected</h3>
              <p className="ai-text-sm ai-text-muted-foreground">左侧会列出关键 instruction 文件和 daily memory 文件。</p>
            </div>
          )}

          {data ? (
            <div className="ai-detail-note">Daily memory directory: {data.dailyMemoryDir}</div>
          ) : null}
        </aside>
      </section>
    </div>
  );
}