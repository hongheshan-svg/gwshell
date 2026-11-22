import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';
import { EMPTY_THREAD, useAiChatStore, type AiChatMessage } from '../stores/aiChatStore';
import { useConfirm } from './useConfirm';
import {
  compatibleProviderLabels,
  getAiModelDisplayName,
  isAiProviderUsable,
} from '../lib/aiModels';
import { getTerminalAiContext } from '../lib/terminalContext';
import { sendInputToTab } from '../lib/terminalLifecycle';
import { terminalInstances } from '../components/Terminal/terminalRegistry';
import type {
  AgentToolResult,
  AiProviderSettings,
  ChatMessage,
  CommandRiskLevel,
  TerminalAiChatRequest,
} from '../types/agent';

interface TerminalAiEventPayload {
  textDelta?: string;
  thinkingDelta?: string;
  text?: string;
  requestedModel?: string;
  responseModel?: string | null;
  message?: string;
}

const MAX_HISTORY_TURNS = 12;
const MIN_IDLE_TIMEOUT_SECS = 120;
const IDLE_GRACE_SECS = 15;

const genId = (prefix: string) =>
  globalThis.crypto?.randomUUID?.() ??
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const formatErr = (err: unknown): string => {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String(err.message);
  return String(err);
};

function buildHistoryPayload(messages: AiChatMessage[]): ChatMessage[] {
  const turns: ChatMessage[] = [];
  for (const m of messages) {
    if (m.streaming || m.error) continue;
    if (m.role === 'user' && m.content.trim()) {
      turns.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant' && m.content.trim()) {
      turns.push({ role: 'assistant', content: m.content });
    } else if (m.role === 'tool' && m.toolResult) {
      const tr = m.toolResult;
      const summary = [
        `Executed command: \`${tr.command}\``,
        `Status: ${tr.ok ? 'OK (exit 0)' : `FAILED (${tr.error ?? 'non-zero exit'})`}`,
        tr.output ? `Output:\n\`\`\`\n${tr.output}\n\`\`\`` : 'Output: (empty)',
      ].join('\n');
      turns.push({ role: 'user', content: summary });
    }
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

export function useAiAssistant() {
  const { t } = useTranslation();
  const confirm = useConfirm();

  const tabs = useAppStore((s) => s.tabs);
  const sessions = useAppStore((s) => s.sessions);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const agentPanelOpen = useAppStore((s) => s.agentPanelOpen);
  const openSettingsNav = useAppStore((s) => s.openSettingsNav);

  const mode = useAiChatStore((s) => s.mode);
  const setMode = useAiChatStore((s) => s.setMode);
  const includeContext = useAiChatStore((s) => s.includeContext);
  const setIncludeContext = useAiChatStore((s) => s.setIncludeContext);
  const threadsByKey = useAiChatStore((s) => s.threadsByKey);
  const streamingKey = useAiChatStore((s) => s.streamingKey);
  const streamingPhase = useAiChatStore((s) => s.streamingPhase);
  const setDraft = useAiChatStore((s) => s.setDraft);
  const appendMessage = useAiChatStore((s) => s.appendMessage);
  const updateMessage = useAiChatStore((s) => s.updateMessage);
  const clearThread = useAiChatStore((s) => s.clearThread);
  const setStreaming = useAiChatStore((s) => s.setStreaming);
  const setStreamingPhase = useAiChatStore((s) => s.setStreamingPhase);
  const pruneThreads = useAiChatStore((s) => s.pruneThreads);

  const [aiSettings, setAiSettings] = useState<AiProviderSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [contextTick, setContextTick] = useState(0);
  const [runningCommand, setRunningCommand] = useState<string | null>(null);

  const unlistenersRef = useRef<(() => void)[]>([]);
  const activeReqRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const cleanupListeners = useCallback(() => {
    for (const fn of unlistenersRef.current) {
      try {
        fn();
      } catch {}
    }
    unlistenersRef.current = [];
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (activeReqRef.current) {
        invoke('cancel_terminal_ai_chat', { requestId: activeReqRef.current }).catch(() => {});
      }
      cleanupListeners();
    };
  }, [cleanupListeners]);

  const refreshAiSettings = useCallback(async (): Promise<AiProviderSettings | null> => {
    try {
      const loaded = await invoke<AiProviderSettings>('load_ai_provider_settings');
      if (mountedRef.current) {
        setAiSettings(loaded);
        setSettingsLoaded(true);
      }
      return loaded;
    } catch {
      if (mountedRef.current) {
        setAiSettings(null);
        setSettingsLoaded(true);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    if (agentPanelOpen) {
      void refreshAiSettings();
    }
  }, [agentPanelOpen, refreshAiSettings]);

  useEffect(() => {
    const handler = () => void refreshAiSettings();
    window.addEventListener('gwshell-ai-settings-changed', handler);
    return () => window.removeEventListener('gwshell-ai-settings-changed', handler);
  }, [refreshAiSettings]);

  useEffect(() => {
    if (!agentPanelOpen) return;
    const id = window.setInterval(() => setContextTick((n) => n + 1), 1500);
    return () => window.clearInterval(id);
  }, [agentPanelOpen]);

  useEffect(() => {
    pruneThreads(new Set(tabs.map((tab) => tab.id)));
  }, [pruneThreads, tabs]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId && tab.type !== 'asset-list') ?? null,
    [activeTabId, tabs],
  );
  const activeSession = useMemo(
    () => (activeTab ? (sessions.find((s) => s.id === activeTab.sessionId) ?? null) : null),
    [activeTab, sessions],
  );

  const threadKey = activeTab?.id ?? 'global';
  const thread = threadsByKey[threadKey] ?? EMPTY_THREAD;
  const isBusyHere = streamingKey === threadKey;
  const isAnyStreaming = streamingKey !== null;

  const terminalContext = useMemo(
    () => (activeTab ? getTerminalAiContext(activeTab.id) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab?.id, contextTick],
  );

  const selectionChars = terminalContext?.selectedText?.trim().length ?? 0;
  const outputKb = terminalContext?.recentOutput?.trim()
    ? Math.max(1, Math.round(terminalContext.recentOutput.length / 1024))
    : 0;
  const cwd = terminalContext?.cwd ?? '';
  const canExecSsh = activeTab?.type === 'ssh' && Boolean(activeTab.connected);
  const modelReady = isAiProviderUsable(aiSettings);
  const modelLabel = aiSettings ? getAiModelDisplayName(aiSettings) : t('terminal_ai_add_model');
  const modelMeta = aiSettings
    ? `${compatibleProviderLabels[aiSettings.provider]} · ${aiSettings.model}`
    : t('terminal_ai_add_model');

  const stopStreaming = useCallback(() => {
    const reqId = activeReqRef.current;
    activeReqRef.current = null;
    if (reqId) {
      invoke('cancel_terminal_ai_chat', { requestId: reqId }).catch(() => {});
    }
    cleanupListeners();
    const prevKey = useAiChatStore.getState().streamingKey;
    if (prevKey) {
      const msgs = useAiChatStore.getState().threadsByKey[prevKey]?.messages ?? [];
      const last = msgs[msgs.length - 1];
      if (last?.streaming) {
        updateMessage(prevKey, last.id, (m) => ({
          ...m,
          streaming: false,
          content: m.content || t('ai_stopped_generation'),
        }));
      }
    }
    setStreaming(null, null, '');
  }, [cleanupListeners, setStreaming, t, updateMessage]);

  const streamTurn = useCallback(
    async (
      targetKey: string,
      questionText: string,
      historyBeforeTurn: ChatMessage[],
      assistantMsgId: string,
    ) => {
      const requestId = genId('ai-req');
      activeReqRef.current = requestId;
      setStreaming(targetKey, requestId, t('ai_phase_connecting'));

      const isCurrent = () => mountedRef.current && activeReqRef.current === requestId;

      const latestSettings = await refreshAiSettings();
      if (!isCurrent()) return;
      if (!latestSettings || !isAiProviderUsable(latestSettings)) {
        activeReqRef.current = null;
        setStreaming(null, null, '');
        updateMessage(targetKey, assistantMsgId, (m) => ({
          ...m,
          streaming: false,
          error: latestSettings?.enabled
            ? t('terminal_ai_model_unavailable')
            : t('terminal_ai_model_disabled'),
        }));
        return;
      }

      const attachCtx = Boolean(activeTab && includeContext);
      const liveCtx = attachCtx && activeTab ? getTerminalAiContext(activeTab.id) : null;
      const shellHint =
        activeTab?.type === 'localshell'
          ? (activeSession?.shell_name ?? 'local shell')
          : activeTab?.type === 'ssh'
            ? (activeSession?.remote_shell ?? 'ssh')
            : (activeTab?.type ?? null);

      const request: TerminalAiChatRequest = {
        request_id: requestId,
        tab_id: targetKey,
        target_session_id: activeTab?.sessionId ?? 'global',
        tab_title: activeTab?.title ?? 'GWShell',
        question: questionText,
        cwd: liveCtx?.cwd ?? null,
        prompt: liveCtx?.prompt ?? activeTab?.title ?? null,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        selected_text: liveCtx?.selectedText?.trim() || null,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        recent_output: liveCtx?.recentOutput?.trim() || null,
        history: historyBeforeTurn,
        mode,
        session_type: activeTab?.type ?? 'global',
        shell_hint: shellHint,
        include_context: attachCtx,
      };

      const deltaEvent = `terminal-ai-delta-${requestId}`;
      const doneEvent = `terminal-ai-done-${requestId}`;
      const errorEvent = `terminal-ai-error-${requestId}`;

      const idleTimeoutMs =
        (Math.max(MIN_IDLE_TIMEOUT_SECS, latestSettings.request_timeout_secs) + IDLE_GRACE_SECS) *
        1000;
      let idleTimer: ReturnType<typeof window.setTimeout> | null = null;
      let rejectIdle: ((err: Error) => void) | null = null;
      const armTimer = () => {
        if (idleTimer) window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => {
          invoke('cancel_terminal_ai_chat', { requestId }).catch(() => {});
          rejectIdle?.(
            new Error(t('terminal_ai_timeout_error', { seconds: Math.ceil(idleTimeoutMs / 1000) })),
          );
        }, idleTimeoutMs);
      };

      let sawText = false;
      try {
        cleanupListeners();
        const unlistenDelta = await listen<TerminalAiEventPayload>(deltaEvent, (ev) => {
          if (!isCurrent()) return;
          if (ev.payload.thinkingDelta) {
            armTimer();
            setStreamingPhase(t('ai_phase_thinking'));
            const chunk = ev.payload.thinkingDelta;
            updateMessage(targetKey, assistantMsgId, (m) => ({
              ...m,
              thinking: (m.thinking ?? '') + chunk,
            }));
          }
          if (ev.payload.textDelta) {
            sawText = true;
            armTimer();
            setStreamingPhase(t('terminal_ai_phase_streaming'));
            const chunk = ev.payload.textDelta;
            updateMessage(targetKey, assistantMsgId, (m) => ({
              ...m,
              content: m.content + chunk,
            }));
          }
        });
        const unlistenDone = await listen<TerminalAiEventPayload>(doneEvent, (ev) => {
          if (!isCurrent()) return;
          const finalText = ev.payload.text;
          const requestedModel = ev.payload.requestedModel ?? latestSettings.model;
          const responseModel = ev.payload.responseModel ?? undefined;
          updateMessage(targetKey, assistantMsgId, (m) => ({
            ...m,
            content: !sawText && finalText ? finalText : m.content,
            requestedModel,
            responseModel,
          }));
        });
        const unlistenError = await listen<TerminalAiEventPayload>(errorEvent, (ev) => {
          if (!isCurrent() || !ev.payload.message) return;
          const msg = ev.payload.message;
          updateMessage(targetKey, assistantMsgId, (m) => ({ ...m, error: msg }));
        });
        unlistenersRef.current = [unlistenDelta, unlistenDone, unlistenError];

        setStreamingPhase(t('terminal_ai_thinking'));
        armTimer();

        const fullText = await Promise.race([
          invoke<string>('run_terminal_ai_chat', { request }),
          new Promise<never>((_, reject) => {
            rejectIdle = reject;
          }),
        ]);

        if (!isCurrent()) return;
        updateMessage(targetKey, assistantMsgId, (m) => ({
          ...m,
          content: sawText ? m.content : fullText,
          streaming: false,
          error: undefined,
        }));
      } catch (err) {
        if (!isCurrent()) return;
        const msg = formatErr(err);
        updateMessage(targetKey, assistantMsgId, (m) => ({
          ...m,
          streaming: false,
          error: msg,
        }));
      } finally {
        if (idleTimer) window.clearTimeout(idleTimer);
        if (activeReqRef.current === requestId) {
          activeReqRef.current = null;
          cleanupListeners();
          if (mountedRef.current) {
            setStreaming(null, null, '');
          }
        }
      }
    },
    [
      activeSession?.remote_shell,
      activeSession?.shell_name,
      activeTab,
      cleanupListeners,
      includeContext,
      mode,
      refreshAiSettings,
      setStreaming,
      setStreamingPhase,
      t,
      updateMessage,
    ],
  );

  const sendMessage = useCallback(
    async (explicitText?: string) => {
      const text = (explicitText ?? thread.draft).trim();
      if (!text || isAnyStreaming) return;

      const existingMessages = useAiChatStore.getState().threadsByKey[threadKey]?.messages ?? [];
      const history = buildHistoryPayload(existingMessages);

      const userMsg: AiChatMessage = {
        id: genId('msg-u'),
        role: 'user',
        content: text,
        createdAt: Date.now(),
      };
      const assistantMsg: AiChatMessage = {
        id: genId('msg-a'),
        role: 'assistant',
        content: '',
        thinking: '',
        streaming: true,
        createdAt: Date.now(),
      };

      if (!explicitText) setDraft(threadKey, '');
      appendMessage(threadKey, userMsg);
      appendMessage(threadKey, assistantMsg);

      await streamTurn(threadKey, text, history, assistantMsg.id);
    },
    [appendMessage, isAnyStreaming, setDraft, streamTurn, thread.draft, threadKey],
  );

  const retryLast = useCallback(async () => {
    if (isAnyStreaming) return;
    const msgs = useAiChatStore.getState().threadsByKey[threadKey]?.messages ?? [];
    const lastUserIdx = [...msgs].reverse().findIndex((m) => m.role === 'user');
    if (lastUserIdx === -1) return;
    const realIdx = msgs.length - 1 - lastUserIdx;
    const lastUser = msgs[realIdx];
    const priorHistory = buildHistoryPayload(msgs.slice(0, realIdx));

    const assistantMsg: AiChatMessage = {
      id: genId('msg-a'),
      role: 'assistant',
      content: '',
      thinking: '',
      streaming: true,
      createdAt: Date.now(),
    };
    appendMessage(threadKey, assistantMsg);
    await streamTurn(threadKey, lastUser.content, priorHistory, assistantMsg.id);
  }, [appendMessage, isAnyStreaming, streamTurn, threadKey]);

  const confirmRiskIfNeeded = useCallback(
    async (command: string, risk: CommandRiskLevel): Promise<boolean> => {
      if (risk === 'safe' || risk === 'low') return true;
      return confirm({
        title: t('ai_confirm_run_title'),
        message: t('ai_confirm_run_msg', {
          risk: risk === 'high' ? t('ai_risk_high') : t('ai_risk_medium'),
          command,
        }),
        confirmLabel: t('ai_cmd_run'),
        cancelLabel: t('common_cancel'),
        danger: risk === 'high',
      });
    },
    [confirm, t],
  );

  const runCommandInTerminal = useCallback(
    async (command: string, risk: CommandRiskLevel) => {
      if (!activeTab) return;
      const ok = await confirmRiskIfNeeded(command, risk);
      if (!ok) return;
      sendInputToTab(activeTab.id, `${command.trimEnd()}\r`);
      terminalInstances.get(activeTab.id)?.terminal.focus();
    },
    [activeTab, confirmRiskIfNeeded],
  );

  const insertCommandToTerminal = useCallback(
    (command: string) => {
      if (!activeTab) return;
      sendInputToTab(activeTab.id, command.trimEnd());
      terminalInstances.get(activeTab.id)?.terminal.focus();
    },
    [activeTab],
  );

  const runAndAnalyzeSsh = useCallback(
    async (command: string, risk: CommandRiskLevel) => {
      if (!activeTab || !canExecSsh || isAnyStreaming || runningCommand) return;
      const ok = await confirmRiskIfNeeded(command, risk);
      if (!ok) return;

      setRunningCommand(command);
      try {
        const res = await invoke<AgentToolResult>('run_agent_ssh_command', {
          targetSessionId: activeTab.sessionId,
          command,
        });
        const toolMsg: AiChatMessage = {
          id: genId('msg-t'),
          role: 'tool',
          content: res.output.length > 0 ? res.output : (res.error ?? ''),
          toolResult: {
            command,
            ok: res.ok,
            output: res.output,
            error: res.error,
          },
          createdAt: Date.now(),
        };
        appendMessage(threadKey, toolMsg);

        const updatedMsgs = useAiChatStore.getState().threadsByKey[threadKey]?.messages ?? [];
        const history = buildHistoryPayload(updatedMsgs);
        const followUp = t('ai_analyze_tool_output_prompt', { command });
        const assistantMsg: AiChatMessage = {
          id: genId('msg-a'),
          role: 'assistant',
          content: '',
          thinking: '',
          streaming: true,
          createdAt: Date.now(),
        };
        appendMessage(threadKey, assistantMsg);
        await streamTurn(threadKey, followUp, history, assistantMsg.id);
      } catch (err) {
        appendMessage(threadKey, {
          id: genId('msg-t'),
          role: 'tool',
          content: formatErr(err),
          toolResult: {
            command,
            ok: false,
            output: '',
            error: formatErr(err),
          },
          createdAt: Date.now(),
        });
      } finally {
        if (mountedRef.current) setRunningCommand(null);
      }
    },
    [
      activeTab,
      appendMessage,
      canExecSsh,
      confirmRiskIfNeeded,
      isAnyStreaming,
      runningCommand,
      streamTurn,
      t,
      threadKey,
    ],
  );

  const clearConversation = useCallback(() => {
    if (isBusyHere) stopStreaming();
    clearThread(threadKey);
  }, [clearThread, isBusyHere, stopStreaming, threadKey]);

  return {
    activeTab,
    threadKey,
    messages: thread.messages,
    draft: thread.draft,
    setDraft: (val: string) => setDraft(threadKey, val),
    mode,
    setMode,
    includeContext,
    setIncludeContext,
    isBusyHere,
    isAnyStreaming,
    streamingPhase,
    runningCommand,
    aiSettings,
    settingsLoaded,
    modelReady,
    modelLabel,
    modelMeta,
    cwd,
    selectionChars,
    outputKb,
    canExecSsh,
    openAiSettings: () => openSettingsNav('agent-ai'),
    sendMessage,
    stopStreaming,
    retryLast,
    runCommandInTerminal,
    insertCommandToTerminal,
    runAndAnalyzeSsh,
    clearConversation,
  };
}
