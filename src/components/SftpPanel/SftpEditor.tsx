import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { X, Save, RotateCcw } from 'lucide-react';

interface SftpEditorProps {
  sessionId: string;
  remotePath: string;
  fileName: string;
  onClose: () => void;
}

export const SftpEditor: React.FC<SftpEditorProps> = ({ sessionId, remotePath, fileName, onClose }) => {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isModified = content !== originalContent;

  useEffect(() => {
    const loadFile = async () => {
      setLoading(true);
      setError(null);
      try {
        const text = await invoke<string>('sftp_read_text', { sessionId, remotePath });
        setContent(text);
        setOriginalContent(text);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };
    loadFile();
  }, [sessionId, remotePath]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke('sftp_write_text', { sessionId, remotePath, content });
      setOriginalContent(content);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [sessionId, remotePath, content]);

  const handleRevert = () => {
    setContent(originalContent);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (isModified) handleSave();
    }
    // Tab key inserts spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = textareaRef.current;
      if (ta) {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const val = content;
        setContent(val.substring(0, start) + '  ' + val.substring(end));
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    }
  };

  const lineCount = content.split('\n').length;

  return (
    <div className="sftp-editor-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !isModified) onClose(); }}>
      <div className="sftp-editor-dialog">
        {/* Header */}
        <div className="sftp-editor-header">
          <span className="sftp-editor-title" title={remotePath}>
            {fileName}
            {isModified && <span className="sftp-editor-modified"> ●</span>}
          </span>
          <div className="sftp-editor-actions">
            <button
              className="sftp-editor-btn"
              onClick={handleRevert}
              disabled={!isModified}
              title={t('sftp_editor_revert')}
            >
              <RotateCcw size={14} />
            </button>
            <button
              className="sftp-editor-btn sftp-editor-btn-save"
              onClick={handleSave}
              disabled={!isModified || saving}
              title={`${t('sftp_editor_save')} (Ctrl+S)`}
            >
              <Save size={14} />
              <span>{saving ? t('sftp_editor_saving') : t('sftp_editor_save')}</span>
            </button>
            <button
              className="sftp-editor-btn"
              onClick={onClose}
              title={t('sftp_close')}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Path info */}
        <div className="sftp-editor-path">{remotePath}</div>

        {/* Error */}
        {error && (
          <div className="sftp-editor-error">
            {error}
            <button className="sftp-error-close" onClick={() => setError(null)}>
              <X size={12} />
            </button>
          </div>
        )}

        {/* Editor body */}
        <div className="sftp-editor-body">
          {loading ? (
            <div className="sftp-editor-loading">{t('sftp_loading')}</div>
          ) : (
            <div className="sftp-editor-content">
              <div className="sftp-editor-gutter">
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i + 1} className="sftp-editor-line-num">{i + 1}</div>
                ))}
              </div>
              <textarea
                ref={textareaRef}
                className="sftp-editor-textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                autoFocus
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sftp-editor-footer">
          <span>{t('sftp_editor_lines', { count: lineCount })}</span>
          <span>{t('sftp_editor_size', { size: new Blob([content]).size })}</span>
        </div>
      </div>
    </div>
  );
};
