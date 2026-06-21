import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AlertCircle, Bot, Check, Copy, Folder, Plus, RotateCcw, SendHorizontal, ShieldCheck, TerminalSquare, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { compatibleProviderLabels, getAiModelDisplayName, isAiProviderUsable } from '../../lib/aiModels';
import { getTerminalAiContext } from '../../lib/terminalContext';
import type { AiProviderSettings, TerminalAiChatRequest } from '../../types/agent';
import { sendInputToTab } from './TerminalView';

interface TerminalAiEventPayload {
  textDelta?: string;
  text?: string;
  message?: string;
}

const MAX_COMMAND_SUGGESTIONS = 6;
const TERMINAL_AI_SETTINGS_TIMEOUT_MS = 5000;
const TERMINAL_AI_TIMEOUT_GRACE_SECS = 5;
const SHELL_FENCE_LANGS = new Set(['', 'bash', 'sh', 'shell', 'zsh', 'fish', 'terminal', 'console', 'cmd', 'powershell', 'pwsh']);

const newRequestId = () =>
  globalThis.crypto?.randomUUID?.() ?? `terminal-ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const formatError = (err: unknown): string => {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
};

const invokeWithTimeout = async <T,>(command: string, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timeoutHandle: ReturnType<typeof window.setTimeout> | null = null;
  try {
    return await Promise.race([
      invoke<T>(command),
      new Promise<never>((_, reject) => {
        timeoutHandle = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) window.clearTimeout(timeoutHandle);
  }
};

const cleanCommandLine = (line: string) => {
  const trimmed = line.trim();
  const promptMatch = trimmed.match(/^(?:(?:[\w.-]+@[\w.-]+(?::[^$#>\s]+)?)?[$#>]|\$|#|>)\s+(.+)$/);
  return (promptMatch?.[1] ?? trimmed).trim();
};

const isCommandCandidate = (line: string) => {
  if (!line || line.length > 260) return false;
  if (line.startsWith('#') || line.startsWith('//')) return false;
  if (/^(output|result|返回|输出|说明)[:：]/i.test(line)) return false;
  if (/^```/.test(line)) return false;
  return /^(?:sudo\s+)?(?:[A-Za-z0-9_./-]+)(?:\s|$)/.test(line);
};

const addCommandCandidate = (commands: string[], seen: Set<string>, rawLine: string) => {
  const command = cleanCommandLine(rawLine);
  if (!isCommandCandidate(command) || seen.has(command)) return;
  seen.add(command);
  commands.push(command);
};

const extractTerminalCommands = (text: string) => {
  const commands: string[] = [];
  const seen = new Set<string>();
  const fenceRegex = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(text)) && commands.length < MAX_COMMAND_SUGGESTIONS) {
    const lang = match[1].trim().toLowerCase();
    if (!SHELL_FENCE_LANGS.has(lang)) continue;
    for (const line of match[2].split('\n')) {
      if (commands.length >= MAX_COMMAND_SUGGESTIONS) break;
      addCommandCandidate(commands, seen, line);
    }
  }

  for (const line of text.split('\n')) {
    if (commands.length >= MAX_COMMAND_SUGGESTIONS) break;
    if (/^\s*(?:(?:[\w.-]+@[\w.-]+(?::[^$#>\s]+)?)?[$#>]|\$|#|>)\s+\S+/.test(line)) {
      addCommandCandidate(commands, seen, line);
    }
  }

  return commands;
};

export const TerminalAiDock: React.FC = () => {
  const { t } = useTranslation();
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const openSettingsNav = useAppStore((s) => s.openSettingsNav);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [phase, setPhase] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiProviderSettings | null>(null);
  const [copied, setCopied] = useState(false);
  const [contextTick, setContextTick] = useState(0);
  const unlistenersRef = useRef<Array<() => void>>([]);
  const listenerRequestIdRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const cleanupListeners = useCallback((requestId?: string) => {
    if (requestId && listenerRequestIdRef.current !== requestId) return;
    unlistenersRef.current.forEach((fn) => fn());
    unlistenersRef.current = [];
    listenerRequestIdRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      cleanupListeners();
    };
  }, [cleanupListeners]);

  const refreshAiSettings = useCallback(async (throwOnError = false) => {
    try {
      const loaded = await invokeWithTimeout<AiProviderSettings>(
        'load_ai_provider_settings',
        TERMINAL_AI_SETTINGS_TIMEOUT_MS,
        t('terminal_ai_settings_timeout_error'),
      );
      if (mountedRef.current) setAiSettings(loaded);
      return loaded;
    } catch (err) {
      if (mountedRef.current) setAiSettings(null);
      if (throwOnError) throw err;
      return null;
    }
  }, [t]);

  useEffect(() => {
    if (open) void refreshAiSettings();
  }, [open, refreshAiSettings]);

  useEffect(() => {
    const handler = () => void refreshAiSettings();
    window.addEventListener('gwshell-ai-settings-changed', handler);
    return () => window.removeEventListener('gwshell-ai-settings-changed', handler);
  }, [refreshAiSettings]);

  // Refresh the context snapshot while the dock is open so the selection /
  // recent-output chips reflect what the user just highlighted or scrolled to.
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setContextTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId && tab.type !== 'asset-list'),
    [activeTabId, tabs],
  );
  const context = useMemo(
    () => (activeTab ? getTerminalAiContext(activeTab.id) : null),
    // contextTick forces a re-read so selection/output chips stay fresh while open
    [activeTab?.id, contextTick],
  );
  const promptChip = context?.prompt || activeTab?.title || t('terminal_ai_no_prompt');
  const cwdChip = context?.cwd || t('terminal_ai_unknown_cwd');
  const selectionChars = context?.selectedText?.trim().length ?? 0;
  const outputKb = context?.recentOutput
    ? Math.max(1, Math.round(context.recentOutput.length / 1024))
    : 0;
  const modelReady = isAiProviderUsable(aiSettings);
  const modelLabel = aiSettings ? getAiModelDisplayName(aiSettings) : t('terminal_ai_add_model');
  const modelMeta = aiSettings
    ? `${compatibleProviderLabels[aiSettings.provider]} / ${aiSettings.model} / ${aiSettings.base_url}`
    : t('terminal_ai_add_model');
  const commandSuggestions = useMemo(() => extractTerminalCommands(answer), [answer]);

  const executeInput = () => {
    if (!activeTab || !input.trim()) return;
    const ok = sendInputToTab(activeTab.id, `${input.trimEnd()}\r`);
    if (!ok) {
      setError(t('terminal_ai_execute_failed'));
      return;
    }
    setInput('');
  };

  const stopWaiting = useCallback((showNotice = true) => {
    const requestId = activeRequestIdRef.current;
    activeRequestIdRef.current = null;
    if (requestId) cleanupListeners(requestId);
    setBusy(false);
    setPhase('');
    if (showNotice) setNotice(t('terminal_ai_stopped_waiting'));
  }, [cleanupListeners, t]);

  const insertCommand = (command: string) => {
    if (!activeTab) return;
    const ok = sendInputToTab(activeTab.id, command);
    if (!ok) setError(t('terminal_ai_insert_failed'));
  };

  const copyAnswer = async () => {
    if (!answer) return;
    await navigator.clipboard.writeText(answer).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const askAgent = async () => {
    if (!activeTab || !input.trim() || busy) return;
    const requestId = newRequestId();
    activeRequestIdRef.current = requestId;
    setBusy(true);
    setPhase(t('terminal_ai_phase_loading_model'));
    setError('');
    setNotice('');
    setAnswer('');

    const isCurrentRequest = () => mountedRef.current && activeRequestIdRef.current === requestId;

    let latestSettings: AiProviderSettings | null = null;
    try {
      latestSettings = await refreshAiSettings(true);
    } catch (err) {
      if (isCurrentRequest()) {
        activeRequestIdRef.current = null;
        setBusy(false);
        setPhase('');
        setAnswer('');
        setError(formatError(err));
      }
      return;
    }
    if (!isCurrentRequest()) return;
    if (!latestSettings || !isAiProviderUsable(latestSettings)) {
      activeRequestIdRef.current = null;
      setBusy(false);
      setPhase('');
      setAnswer('');
      setError(latestSettings?.enabled ? t('terminal_ai_model_unavailable') : t('terminal_ai_model_disabled'));
      return;
    }
    setAiSettings(latestSettings);
    const currentContext = getTerminalAiContext(activeTab.id);
    const request: TerminalAiChatRequest = {
      request_id: requestId,
      tab_id: activeTab.id,
      target_session_id: activeTab.sessionId,
      tab_title: activeTab.title,
      question: input.trim(),
      cwd: currentContext.cwd ?? null,
      prompt: currentContext.prompt ?? activeTab.title,
      selected_text: currentContext.selectedText?.trim() || null,
      recent_output: currentContext.recentOutput?.trim() || null,
    };

    const deltaEvent = `terminal-ai-delta-${requestId}`;
    const doneEvent = `terminal-ai-done-${requestId}`;
    const errorEvent = `terminal-ai-error-${requestId}`;
    const timeoutMs = Math.max(1, latestSettings.request_timeout_secs + TERMINAL_AI_TIMEOUT_GRACE_SECS) * 1000;
    let timeoutHandle: ReturnType<typeof window.setTimeout> | null = null;
    let sawDelta = false;
    try {
      cleanupListeners();
      const requestUnlisteners: Array<() => void> = [];
      try {
        const unlistenDelta = await listen<TerminalAiEventPayload>(deltaEvent, (event) => {
          if (!isCurrentRequest() || !event.payload.textDelta) return;
          sawDelta = true;
          setPhase(t('terminal_ai_phase_streaming'));
          setAnswer((prev) => prev + event.payload.textDelta);
        });
        requestUnlisteners.push(unlistenDelta);
        const unlistenDone = await listen<TerminalAiEventPayload>(doneEvent, (event) => {
          if (!isCurrentRequest()) return;
          if (!sawDelta && event.payload.text) setAnswer(event.payload.text);
          activeRequestIdRef.current = null;
          setBusy(false);
          setPhase('');
          cleanupListeners(requestId);
        });
        requestUnlisteners.push(unlistenDone);
        const unlistenError = await listen<TerminalAiEventPayload>(errorEvent, (event) => {
          if (!isCurrentRequest()) return;
          activeRequestIdRef.current = null;
          setBusy(false);
          setPhase('');
          setError(event.payload.message || t('terminal_ai_error'));
          cleanupListeners(requestId);
        });
        requestUnlisteners.push(unlistenError);
        if (!isCurrentRequest()) {
          requestUnlisteners.forEach((fn) => fn());
          return;
        }
        listenerRequestIdRef.current = requestId;
        unlistenersRef.current = requestUnlisteners;
      } catch (listenErr) {
        requestUnlisteners.forEach((fn) => fn());
        console.warn('Terminal AI event subscription failed; falling back to IPC result.', listenErr);
      }
      if (!isCurrentRequest()) return;
      setPhase(t('terminal_ai_phase_requesting'));
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = window.setTimeout(() => {
          reject(new Error(t('terminal_ai_timeout_error', { seconds: Math.ceil(timeoutMs / 1000) })));
        }, timeoutMs);
      });
      const fullText = await Promise.race([
        invoke<string>('run_terminal_ai_chat', { request }),
        timeoutPromise,
      ]);
      if (isCurrentRequest()) {
        activeRequestIdRef.current = null;
        if (!sawDelta) setAnswer(fullText);
        setBusy(false);
        setPhase('');
      }
    } catch (err) {
      if (isCurrentRequest()) {
        activeRequestIdRef.current = null;
        setBusy(false);
        setPhase('');
        setError(formatError(err));
      }
    } finally {
      if (timeoutHandle) window.clearTimeout(timeoutHandle);
      cleanupListeners(requestId);
    }
  };

  if (!activeTab) return null;

  if (!open) {
    return (
      <button
        className="terminal-ai-fab"
        onClick={() => setOpen(true)}
        title={t('terminal_ai_open')}
        type="button"
      >
        <Bot size={18} />
      </button>
    );
  }

  return (
    <div className="terminal-ai-dock">
      <div className="terminal-ai-topbar">
        <div className="terminal-ai-context">
          <span className="terminal-ai-chip"><Folder size={15} /> {cwdChip}</span>
          <span className="terminal-ai-chip">{promptChip}</span>
          <span
            className={`terminal-ai-chip terminal-ai-context-tag${selectionChars > 0 ? ' is-active' : ''}`}
            title={t('terminal_ai_context_selection', { chars: selectionChars })}
          >
            {t('terminal_ai_context_selection_label')} {selectionChars > 0 ? selectionChars : '—'}
          </span>
          <span
            className={`terminal-ai-chip terminal-ai-context-tag${outputKb > 0 ? ' is-active' : ''}`}
            title={t('terminal_ai_context_output', { kb: outputKb })}
          >
            {t('terminal_ai_context_output_label')} {outputKb > 0 ? `${outputKb}KB` : '—'}
          </span>
        </div>
        <button
          className="terminal-ai-icon-btn"
          onClick={() => {
            if (busy) stopWaiting(false);
            setOpen(false);
          }}
          title={t('terminal_ai_close')}
          type="button"
        >
          <X size={16} />
        </button>
      </div>

      {(answer || error || busy || notice) && (
        <div className="terminal-ai-response">
          {answer && (
            <div className="terminal-ai-answer">
              <pre>{answer}</pre>
              <button
                className="terminal-ai-copy"
                onClick={() => void copyAnswer()}
                title={t('terminal_ai_copy_answer')}
                type="button"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? t('terminal_ai_copied') : t('terminal_ai_copy')}</span>
              </button>
            </div>
          )}
          {commandSuggestions.length > 0 && (
            <div className="terminal-ai-command-list">
              <div className="terminal-ai-command-title">{t('terminal_ai_command_suggestions')}</div>
              {commandSuggestions.map((command) => (
                <button
                  className="terminal-ai-command-chip"
                  key={command}
                  onClick={() => insertCommand(command)}
                  title={command}
                  type="button"
                >
                  <TerminalSquare size={14} />
                  <code>{command}</code>
                  <span>{t('terminal_ai_insert_command')}</span>
                </button>
              ))}
            </div>
          )}
          {busy && (
            <div className="terminal-ai-busy-row">
              <span className="terminal-ai-muted">{phase || t('terminal_ai_thinking')}</span>
              <button className="terminal-ai-stop" onClick={() => stopWaiting()} type="button">
                {t('terminal_ai_stop_waiting')}
              </button>
            </div>
          )}
          {notice && !busy && <span className="terminal-ai-muted">{notice}</span>}
          {error && (
            <div className="terminal-ai-error-box">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      <textarea
        className="terminal-ai-input"
        disabled={busy}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void askAgent();
          }
        }}
        placeholder={t('terminal_ai_placeholder')}
        value={input}
      />

      <div className="terminal-ai-toolbar">
        <button className="terminal-ai-primary" disabled={!input.trim() || busy} onClick={executeInput} type="button">
          <TerminalSquare size={15} /> {t('terminal_ai_execute')}
        </button>
        <button className="terminal-ai-ghost" disabled={!input.trim() || busy} onClick={() => void askAgent()} type="button">
          <Bot size={15} /> {t('terminal_ai_agent')}
        </button>
        <button
          className={`terminal-ai-model${modelReady ? ' is-ready' : ' is-missing'}`}
          onClick={() => openSettingsNav('agent-ai')}
          title={modelMeta}
          type="button"
        >
          {modelReady ? <Bot size={15} /> : <Plus size={15} />}
          <span>{modelReady ? modelLabel : t('terminal_ai_add_model')}</span>
        </button>
        <button className="terminal-ai-icon-btn" onClick={() => { setAnswer(''); setError(''); setNotice(''); }} title={t('terminal_ai_clear')} type="button">
          <RotateCcw size={15} />
        </button>
        <span className="terminal-ai-safe"><ShieldCheck size={15} /></span>
        <span className="terminal-ai-count">{input.length}</span>
        <button className="terminal-ai-send" disabled={!input.trim() || busy} onClick={() => void askAgent()} type="button">
          <SendHorizontal size={18} />
        </button>
      </div>
    </div>
  );
};
