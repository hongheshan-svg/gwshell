import React, { useState, useEffect, useCallback } from 'react';
import { FileText, RefreshCw, Copy, Check, Download } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { TranslationKeys } from '../../i18n';

interface PromptFile {
  tool: string;
  filename: string;
  content: string;
  exists: boolean;
  path: string;
}

interface Props {
  t: (k: TranslationKeys) => string;
}

export const PromptsManager: React.FC<Props> = ({ t }) => {
  const [projectDir, setProjectDir] = useState('');
  const [files, setFiles] = useState<PromptFile[]>([]);
  const [selectedTool, setSelectedTool] = useState<string>('claude');
  const [editContent, setEditContent] = useState('');
  const [status, setStatus] = useState('');
  const [templates, setTemplates] = useState<[string, string, string][]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    invoke<[string, string, string][]>('get_prompt_templates').then(setTemplates).catch(() => {});
  }, []);

  const loadFiles = useCallback(async () => {
    if (!projectDir) return;
    try {
      const list = await invoke<PromptFile[]>('list_prompt_files', { projectDir });
      setFiles(list);
      const selected = list.find(f => f.tool === selectedTool);
      if (selected) setEditContent(selected.content);
    } catch (e: any) {
      setStatus(`Error: ${e}`);
    }
  }, [projectDir, selectedTool]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const handleSelectTool = (tool: string) => {
    setSelectedTool(tool);
    const f = files.find(ff => ff.tool === tool);
    if (f) setEditContent(f.content);
  };

  const handleSave = async () => {
    const f = files.find(ff => ff.tool === selectedTool);
    if (!f) return;
    try {
      await invoke('write_prompt_file', { filePath: f.path, content: editContent });
      setStatus(t('prompts_save_success'));
      await loadFiles();
      setTimeout(() => setStatus(''), 2000);
    } catch (e: any) {
      setStatus(`Error: ${e}`);
    }
  };

  const handleSync = async () => {
    const targets = files.filter(f => f.tool !== selectedTool).map(f => f.tool);
    try {
      const synced = await invoke<string[]>('sync_prompt_files', {
        projectDir, sourceTool: selectedTool, targetTools: targets, content: editContent,
      });
      setStatus(`${t('prompts_sync_success')}: ${synced.join(', ')}`);
      await loadFiles();
      setTimeout(() => setStatus(''), 3000);
    } catch (e: any) {
      setStatus(`Error: ${e}`);
    }
  };

  const handleApplyTemplate = (content: string) => {
    setEditContent(content);
    setShowTemplates(false);
  };

  const toolInfo: Record<string, { label: string; file: string }> = {
    claude: { label: 'Claude Code', file: 'CLAUDE.md' },
    codex: { label: 'Codex', file: 'AGENTS.md' },
    gemini: { label: 'Gemini CLI', file: 'GEMINI.md' },
  };

  return (
    <div className="prompts-manager">
      <div className="prompts-header">
        <h3>{t('prompts_title')}</h3>
        <p>{t('prompts_desc')}</p>
      </div>

      <div className="ai-form-section">
        <label className="ai-form-label">{t('prompts_project_dir')}</label>
        <input
          className="settings-input ai-form-input"
          value={projectDir}
          onChange={e => setProjectDir(e.target.value)}
          placeholder={t('prompts_dir_placeholder')}
        />
      </div>

      {projectDir && (
        <>
          <div className="prompts-tool-tabs">
            {Object.entries(toolInfo).map(([tool, info]) => {
              const f = files.find(ff => ff.tool === tool);
              return (
                <button
                  key={tool}
                  className={`prompts-tool-tab ${selectedTool === tool ? 'active' : ''}`}
                  onClick={() => handleSelectTool(tool)}
                >
                  <FileText size={12} />
                  <span>{info.label}</span>
                  <span className="prompts-filename">{info.file}</span>
                  {f?.exists && <span className="prompts-exists">✓</span>}
                </button>
              );
            })}
          </div>

          {status && <div className="ai-status-bar">{status}</div>}

          <div className="prompts-toolbar">
            <button className="ai-toolbar-btn primary" onClick={handleSave}>
              <Check size={13} /> {t('common_save')}
            </button>
            <button className="ai-toolbar-btn" onClick={handleSync} title={t('prompts_sync_to_others')}>
              <Copy size={13} /> {t('prompts_sync_to_others')}
            </button>
            <button className="ai-toolbar-btn" onClick={() => setShowTemplates(!showTemplates)}>
              <Download size={13} /> {t('prompts_templates')}
            </button>
            <button className="ai-toolbar-btn" onClick={loadFiles}>
              <RefreshCw size={13} />
            </button>
          </div>

          {showTemplates && (
            <div className="prompts-template-list">
              {templates.map(([id, name, content]) => (
                <button key={id} className="prompts-template-item" onClick={() => handleApplyTemplate(content)}>
                  {name}
                </button>
              ))}
            </div>
          )}

          <textarea
            className="prompts-editor"
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            placeholder={`# ${toolInfo[selectedTool]?.file || ''}\n\nWrite your project instructions here...`}
            spellCheck={false}
          />
        </>
      )}
    </div>
  );
};
