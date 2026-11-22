import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { EMPTY_DOCK_DRAFT, useTerminalAiStore } from '../stores/terminalAiStore';
import {
  compatibleProviderLabels,
  getAiModelDisplayName,
  isAiProviderUsable,
} from '../lib/aiModels';
import { getTerminalAiContext } from '../lib/terminalContext';
import { extractTerminalCommands } from '../lib/terminalAiCommands';
import { sendInputToTab } from '../lib/terminalLifecycle';
import type { AiProviderSettings, TerminalAiChatRequest } from '../types/agent';

interface TerminalAiEventPayload {
  textDelta?: string;
  text?: string;
  message?: string;
}

const TERMINAL_AI_SETTINGS_TIMEOUT_MS = 5000;
const MIN_IDLE_TIMEOUT_SECS = 120;
const TERMINAL_AI_IDLE_GRACE_SECS = 15;

const newRequestId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `terminal-ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const cancelTerminalAiRequest = (requestId: string) => {
  invoke('cancel_terminal_ai_chat', { requestId }).catch(() => {});
};

const formatError = (err: unknown): string => {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String(err.message);
  return String(err);
};

const invokeWithTimeout = async <T>(
  command: string,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
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

export function useTerminalAiChat() {
  const { t } = useTranslation();
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const openSettingsNav = useAppStore((s) => s.openSettingsNav);

  const open = useTerminalAiStore((s) => s.open);
  const setOpen = useTerminalAiStore((s) => s.setOpen);
  const draftsByTab = useTerminalAiStore((s) => s.draftsByTab);
  const updateDraft = useTerminalAiStore((s) => s.updateDraft);
  const pruneDrafts = useTerminalAiStore((s) => s.pruneDrafts);

  const [phase, setPhase] = useState('');
  const [busyTabId, setBusyTabId] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AiProviderSettings | null>(null);
  const [copied, setCopied] = useState(false);
  const [contextTick, setContextTick] = useState(0);

  const unlistenersRef = useRef<(() => void)[]>([]);
  const listenerRequestIdRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const cleanupListeners = useCallback((requestId?: string) => {
    if (requestId && listenerRequestIdRef.current !== requestId) return;
    unlistenersRef.current.forEach((fn) => fn());
    unlistenersRef.current = [];
    listenerRequestIdRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (activeRequestIdRef.current) cancelTerminalAiRequest(activeRequestIdRef.current);
      cleanupListeners();
    };
  }, [cleanupListeners]);

  const refreshAiSettings = useCallback(async (throwOnError = false) => {
    try {
      const loaded = await invokeWithTimeout<AiProviderSettings>(
        'load_ai_provider_settings',
        TERMINAL_AI_SETTINGS_TIMEOUT_MS,
        tRef.current('terminal_ai_settings_timeout_error'),
      );
      if (mountedRef.current) setAiSettings(loaded);
      return loaded;
    } catch (err) {
      if (mountedRef.current) setAiSettings(null);
      if (throwOnError) throw err;
      return null;
    }
  }, []);

  useEffect(() => {
    if (open) {
      void refreshAiSettings();
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open, refreshAiSettings]);

  useEffect(() => {
    const handler = () => void refreshAiSettings();
    window.addEventListener('gwshell-ai-settings-changed', handler);
    return () => window.removeEventListener('gwshell-ai-settings-changed', handler);
  }, [refreshAiSettings]);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setContextTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    pruneDrafts(new Set(tabs.map((tab) => tab.id)));
  }, [pruneDrafts, tabs]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId && tab.type !== 'asset-list'),
    [activeTabId, tabs],
  );
  const currentTabId = activeTab?.id ?? '';
  const currentDraft = draftsByTab[currentTabId] ?? EMPTY_DOCK_DRAFT;
  const { input, answer, error, notice } = currentDraft;
  const busy = busyTabId !== null && busyTabId === currentTabId;

  const context = useMemo(
    () => (activeTab ? getTerminalAiContext(activeTab.id) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab?.id, contextTick],
  );
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const promptChip = context?.prompt || activeTab?.title || t('terminal_ai_no_prompt');
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
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

  const executeInput = useCallback(() => {
    if (!activeTab || !input.trim()) return;
    const ok = sendInputToTab(activeTab.id, `${input.trimEnd()}\r`);
    if (!ok) {
      updateDraft(activeTab.id, (prev) => ({ ...prev, error: t('terminal_ai_execute_failed') }));
      return;
    }
    updateDraft(activeTab.id, (prev) => ({ ...prev, input: '' }));
  }, [activeTab, input, t, updateDraft]);

  const stopWaiting = useCallback(
    (showNotice = true) => {
      const requestId = activeRequestIdRef.current;
      activeRequestIdRef.current = null;
      if (requestId) {
        cancelTerminalAiRequest(requestId);
        cleanupListeners(requestId);
      }
      const stoppedTab = busyTabId;
      setBusyTabId(null);
      setPhase('');
      if (showNotice && stoppedTab) {
        updateDraft(stoppedTab, (prev) => ({ ...prev, notice: t('terminal_ai_stopped_waiting') }));
      }
    },
    [busyTabId, cleanupListeners, t, updateDraft],
  );

  const insertCommand = useCallback(
    (command: string) => {
      if (!activeTab) return;
      const ok = sendInputToTab(activeTab.id, command);
      if (!ok) {
        updateDraft(activeTab.id, (prev) => ({ ...prev, error: t('terminal_ai_insert_failed') }));
      }
    },
    [activeTab, t, updateDraft],
  );

  const copyAnswer = useCallback(async () => {
    if (!answer) return;
    await navigator.clipboard.writeText(answer).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [answer]);

  const askAgent = useCallback(async () => {
    if (!activeTab || !input.trim() || busyTabId !== null) return;
    const targetTabId = activeTab.id;
    const requestId = newRequestId();
    activeRequestIdRef.current = requestId;
    setBusyTabId(targetTabId);
    setPhase(t('terminal_ai_phase_loading_model'));
    updateDraft(targetTabId, (prev) => ({ ...prev, error: '', notice: '', answer: '' }));

    const isCurrentRequest = () => mountedRef.current && activeRequestIdRef.current === requestId;

    let latestSettings: AiProviderSettings | null = null;
    try {
      latestSettings = await refreshAiSettings(true);
    } catch (err) {
      if (isCurrentRequest()) {
        activeRequestIdRef.current = null;
        setBusyTabId(null);
        setPhase('');
        updateDraft(targetTabId, (prev) => ({ ...prev, answer: '', error: formatError(err) }));
      }
      return;
    }
    if (!isCurrentRequest()) return;
    if (!latestSettings || !isAiProviderUsable(latestSettings)) {
      activeRequestIdRef.current = null;
      setBusyTabId(null);
      setPhase('');
      updateDraft(targetTabId, (prev) => ({
        ...prev,
        answer: '',
        error: latestSettings?.enabled
          ? t('terminal_ai_model_unavailable')
          : t('terminal_ai_model_disabled'),
      }));
      return;
    }
    setAiSettings(latestSettings);
    const currentContext = getTerminalAiContext(targetTabId);
    const request: TerminalAiChatRequest = {
      request_id: requestId,
      tab_id: targetTabId,
      target_session_id: activeTab.sessionId,
      tab_title: activeTab.title,
      question: input.trim(),
      cwd: currentContext.cwd ?? null,
      prompt: currentContext.prompt ?? activeTab.title,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      selected_text: currentContext.selectedText?.trim() || null,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      recent_output: currentContext.recentOutput?.trim() || null,
    };

    const deltaEvent = `terminal-ai-delta-${requestId}`;
    const doneEvent = `terminal-ai-done-${requestId}`;
    const errorEvent = `terminal-ai-error-${requestId}`;
    const idleTimeoutMs =
      (Math.max(MIN_IDLE_TIMEOUT_SECS, latestSettings.request_timeout_secs) +
        TERMINAL_AI_IDLE_GRACE_SECS) *
      1000;
    let timeoutHandle: ReturnType<typeof window.setTimeout> | null = null;
    let rejectIdle: ((err: Error) => void) | null = null;
    const armIdleTimer = () => {
      if (timeoutHandle) window.clearTimeout(timeoutHandle);
      timeoutHandle = window.setTimeout(() => {
        cancelTerminalAiRequest(requestId);
        rejectIdle?.(
          new Error(t('terminal_ai_timeout_error', { seconds: Math.ceil(idleTimeoutMs / 1000) })),
        );
      }, idleTimeoutMs);
    };
    let sawDelta = false;
    try {
      cleanupListeners();
      const requestUnlisteners: (() => void)[] = [];
      try {
        const unlistenDelta = await listen<TerminalAiEventPayload>(deltaEvent, (event) => {
          if (!isCurrentRequest() || !event.payload.textDelta) return;
          sawDelta = true;
          armIdleTimer();
          setPhase(t('terminal_ai_phase_streaming'));
          const delta = event.payload.textDelta;
          updateDraft(targetTabId, (prev) => ({ ...prev, answer: prev.answer + delta }));
        });
        requestUnlisteners.push(unlistenDelta);
        const unlistenDone = await listen<TerminalAiEventPayload>(doneEvent, (event) => {
          if (!isCurrentRequest()) return;
          if (!sawDelta && event.payload.text) {
            const text = event.payload.text;
            updateDraft(targetTabId, (prev) => ({ ...prev, answer: text }));
          }
          activeRequestIdRef.current = null;
          setBusyTabId(null);
          setPhase('');
          cleanupListeners(requestId);
        });
        requestUnlisteners.push(unlistenDone);
        const unlistenError = await listen<TerminalAiEventPayload>(errorEvent, (event) => {
          if (!isCurrentRequest()) return;
          activeRequestIdRef.current = null;
          setBusyTabId(null);
          setPhase('');
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          const msg = event.payload.message || t('terminal_ai_error');
          updateDraft(targetTabId, (prev) => ({ ...prev, error: msg }));
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
        console.warn(
          'Terminal AI event subscription failed; falling back to IPC result.',
          listenErr,
        );
      }
      if (!isCurrentRequest()) return;
      setPhase(t('terminal_ai_phase_requesting'));
      const timeoutPromise = new Promise<never>((_, reject) => {
        rejectIdle = reject;
      });
      armIdleTimer();
      const fullText = await Promise.race([
        invoke<string>('run_terminal_ai_chat', { request }),
        timeoutPromise,
      ]);
      if (isCurrentRequest()) {
        activeRequestIdRef.current = null;
        if (!sawDelta) {
          updateDraft(targetTabId, (prev) => ({ ...prev, answer: fullText }));
        }
        setBusyTabId(null);
        setPhase('');
      }
    } catch (err) {
      if (isCurrentRequest()) {
        activeRequestIdRef.current = null;
        setBusyTabId(null);
        setPhase('');
        updateDraft(targetTabId, (prev) => ({ ...prev, error: formatError(err) }));
      }
    } finally {
      if (timeoutHandle) window.clearTimeout(timeoutHandle);
      cleanupListeners(requestId);
    }
  }, [activeTab, busyTabId, cleanupListeners, input, refreshAiSettings, t, updateDraft]);

  const setInput = useCallback(
    (val: string) => {
      updateDraft(currentTabId, (prev) => ({ ...prev, input: val }));
    },
    [currentTabId, updateDraft],
  );

  const clearResponse = useCallback(() => {
    if (busy) stopWaiting(false);
    updateDraft(currentTabId, (prev) => ({ ...prev, answer: '', error: '', notice: '' }));
  }, [busy, currentTabId, stopWaiting, updateDraft]);

  return {
    activeTab,
    open,
    setOpen,
    textareaRef,
    input,
    setInput,
    answer,
    error,
    notice,
    phase,
    busy,
    busyTabId,
    copied,
    promptChip,
    cwdChip,
    selectionChars,
    outputKb,
    modelReady,
    modelLabel,
    modelMeta,
    commandSuggestions,
    openSettingsNav,
    executeInput,
    stopWaiting,
    insertCommand,
    copyAnswer,
    askAgent,
    clearResponse,
  };
}
