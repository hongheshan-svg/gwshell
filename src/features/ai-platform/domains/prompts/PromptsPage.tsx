import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  syncAiPlatformPromptFiles,
  writeAiPlatformPromptFile,
} from '../../infra/commands/prompts';
import { useAiPlatformPrompts } from '../../infra/query/useAiPlatformPrompts';

const toolInfo: Record<string, { label: string; filename: string }> = {
  claude: { label: 'Claude Code', filename: 'CLAUDE.md' },
  codex: { label: 'Codex', filename: 'AGENTS.md' },
  gemini: { label: 'Gemini CLI', filename: 'GEMINI.md' },
};

const projectDirStorageKey = 'ai-platform.prompts.projectDir';

function getSyncBadgeTone(current: string, baseline: string) {
  if (!current) {
    return 'ai-badge-neutral';
  }
  return current === baseline ? 'ai-badge-success' : 'ai-badge-warning';
}

export function PromptsPage() {
  const queryClient = useQueryClient();
  const [projectDirInput, setProjectDirInput] = useState('');
  const [projectDir, setProjectDir] = useState('');
  const [selectedTool, setSelectedTool] = useState<string>('claude');
  const [editorContent, setEditorContent] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const { data, isLoading, error } = useAiPlatformPrompts(projectDir);

  useEffect(() => {
    const saved = globalThis.localStorage?.getItem(projectDirStorageKey) ?? '';
    if (saved) {
      setProjectDirInput(saved);
      setProjectDir(saved);
    }
  }, []);

  useEffect(() => {
    if (!projectDir) {
      return;
    }
    globalThis.localStorage?.setItem(projectDirStorageKey, projectDir);
  }, [projectDir]);

  const files = data?.files ?? [];
  const selectedFile = useMemo(
    () => files.find((file) => file.tool === selectedTool) ?? files[0],
    [files, selectedTool],
  );

  useEffect(() => {
    if (!selectedFile) {
      return;
    }
    setSelectedTool(selectedFile.tool);
    setEditorContent(selectedFile.content);
  }, [selectedFile]);

  const saveMutation = useMutation({
    mutationFn: ({ filePath, content }: { filePath: string; content: string }) =>
      writeAiPlatformPromptFile(filePath, content),
    onSuccess: async () => {
      setMessage('Prompt 文件已保存。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'prompts', projectDir] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: ({ sourceTool, content }: { sourceTool: string; content: string }) =>
      syncAiPlatformPromptFiles(
        projectDir,
        sourceTool,
        files.filter((file) => file.tool !== sourceTool).map((file) => file.tool),
        content,
      ),
    onSuccess: async (result) => {
      setMessage(`${result.message}: ${result.syncedFiles.join(', ')}`);
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'prompts', projectDir] });
    },
  });

  const existingCount = files.filter((file) => file.exists).length;
  const divergentCount = selectedFile
    ? files.filter((file) => file.tool !== selectedFile.tool && file.content !== selectedFile.content).length
    : 0;

  return (
    <div className="ai-grid ai-gap-6">
      <section className="ai-grid ai-gap-4">
        <div className="ai-section-header">
          <div className="ai-grid ai-gap-2">
            <span className="ai-text-xs ai-uppercase ai-tracking-[0.18em] ai-text-muted-foreground">
              Domain / Prompts
            </span>
            <div className="ai-grid ai-gap-2">
              <h2 className="ai-text-2xl ai-font-semibold ai-text-card-foreground">Prompt Workbench</h2>
              <p className="ai-text-sm ai-text-muted-foreground ai-max-w-2xl">
                管理项目目录内的标准提示词文件，支持 Claude、Codex、Gemini 之间的内容同步和模板套用。
              </p>
            </div>
          </div>
          <div className="ai-flex ai-wrap ai-gap-3">
            <button
              className="ai-button ai-button-secondary"
              onClick={() => {
                setProjectDir(projectDirInput.trim());
                setMessage(null);
              }}
              type="button"
            >
              Load Directory
            </button>
          </div>
        </div>

        <div className="ai-form-grid">
          <label className="ai-field ai-field-span-2">
            <span className="ai-field-label">Project Directory</span>
            <input
              className="ai-input"
              onChange={(event) => setProjectDirInput(event.target.value)}
              placeholder="D:/workspace/project"
              value={projectDirInput}
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
            <span className="ai-stat-label">Drift</span>
            <span className="ai-stat-value">{divergentCount}</span>
          </article>
        </div>

        {message ? <div className="ai-inline-message">{message}</div> : null}
        {error ? <div className="ai-inline-message ai-inline-message-error">{String(error)}</div> : null}
      </section>

      <section className="ai-provider-workbench">
        <div className="ai-grid ai-gap-4">
          {projectDir ? null : (
            <article className="ai-provider-card ai-grid ai-gap-3">
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Select a project directory</h3>
              <p className="ai-text-sm ai-text-muted-foreground">
                输入仓库根目录后即可加载 CLAUDE.md、AGENTS.md 和 GEMINI.md。
              </p>
            </article>
          )}

          {isLoading ? <div className="ai-inline-message">正在加载 Prompt 文件...</div> : null}

          <div className="ai-tool-grid">
            {files.map((file) => (
              <article
                className={`ai-provider-card ${selectedFile?.tool === file.tool ? 'selected' : ''}`}
                key={file.tool}
              >
                <div className="ai-detail-header">
                  <div className="ai-grid ai-gap-1">
                    <button className="ai-card-title-button" onClick={() => setSelectedTool(file.tool)} type="button">
                      {toolInfo[file.tool]?.label ?? file.tool}
                    </button>
                    <span className="ai-text-sm ai-text-muted-foreground">{file.filename}</span>
                  </div>
                  <span className={`ai-badge ${file.exists ? 'ai-badge-success' : 'ai-badge-neutral'}`}>
                    {file.exists ? 'Present' : 'Missing'}
                  </span>
                </div>

                <div className="ai-detail-item">
                  <span className="ai-field-label">Path</span>
                  <span className="ai-detail-value">{file.path}</span>
                </div>

                <div className="ai-flex ai-justify-between ai-items-center">
                  <span className={`ai-badge ${getSyncBadgeTone(file.content, selectedFile?.content ?? '')}`}>
                    {selectedFile && file.tool !== selectedFile.tool
                      ? file.content === selectedFile.content
                        ? 'In Sync'
                        : 'Drift'
                      : 'Source'}
                  </span>
                  <span className="ai-text-xs ai-text-muted-foreground">{file.content.length} chars</span>
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
                  <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">
                    {toolInfo[selectedFile.tool]?.label ?? selectedFile.tool}
                  </h3>
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
                <button
                  className="ai-button ai-button-secondary"
                  disabled={syncMutation.isPending}
                  onClick={() => syncMutation.mutate({ sourceTool: selectedFile.tool, content: editorContent })}
                  type="button"
                >
                  {syncMutation.isPending ? 'Syncing...' : 'Sync To Others'}
                </button>
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
              <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">No prompt file selected</h3>
              <p className="ai-text-sm ai-text-muted-foreground">先加载目录，再选择一个工具作为编辑源。</p>
            </div>
          )}

          <div className="ai-grid ai-gap-3">
            <div className="ai-history-header">
              <div className="ai-grid ai-gap-1">
                <h4 className="ai-text-base ai-font-semibold ai-text-card-foreground">Templates</h4>
                <span className="ai-text-sm ai-text-muted-foreground">将模板内容直接注入当前编辑器。</span>
              </div>
            </div>
            <div className="ai-grid ai-gap-3">
              {(data?.templates ?? []).map((template) => (
                <div className="ai-detail-item" key={template.id}>
                  <div className="ai-detail-header">
                    <div className="ai-grid ai-gap-1">
                      <strong className="ai-text-card-foreground">{template.name}</strong>
                      <span className="ai-text-sm ai-text-muted-foreground">{template.id}</span>
                    </div>
                    <button
                      className="ai-button ai-button-secondary"
                      onClick={() => setEditorContent(template.content)}
                      type="button"
                    >
                      Apply
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