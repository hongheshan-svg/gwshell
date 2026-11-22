import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TabInfo } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTerminalViewport } from '../../hooks/useTerminalViewport';
import { terminalInstances } from './terminalRegistry';
import { isInteractiveTerminal } from '../../lib/terminalPlatform';
import {
  completionAccept,
  completionSetters,
  HIDDEN_COMPLETIONS,
  lineTrackers,
  type CompletionView,
} from '../../lib/terminalCompletionState';
import {
  readClipboardText,
  readTerminalSelection,
  writeClipboardText,
} from '../../lib/terminalClipboard';
import { attachTerminalDragDrop } from '../../lib/terminalInteractions';
import { mountTerminalSession } from '../../lib/terminalSessionController';
import { CompletionDropdown } from './CompletionDropdown';
import { StickyScrollOverlay } from './StickyScrollOverlay';
import { TerminalContextMenu } from './TerminalContextMenu';
import { FingerprintDialog } from './FingerprintDialog';
import { PasteConfirmDialog } from './PasteConfirmDialog';
import type { FingerprintInfo, TerminalContextMenuState } from './types';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  tab: TabInfo;
  isActive: boolean;
  visible?: boolean;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ tab, isActive, visible }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessions = useAppStore((s) => s.sessions);
  const theme = useAppStore((s) => s.theme);
  const terminalCmdHint = useSettingsStore((s) => s.settings.terminalCmdHint);
  const terminalFont = useSettingsStore((s) => s.settings.terminalFont);
  const terminalFontSize = useSettingsStore((s) => s.settings.terminalFontSize);
  const terminalStickyScroll = useSettingsStore((s) => s.settings.terminalStickyScroll);
  const broadcastInput = useAppStore((s) => s.broadcastInput);
  const { t } = useTranslation();

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const selectionSnapshotRef = useRef('');
  const fingerprintResolveRef = useRef<(accepted: boolean) => void>(() => {});
  const isVisibleRef = useRef<boolean>(visible ?? isActive);
  isVisibleRef.current = visible ?? isActive;

  const [fingerprintInfo, setFingerprintInfo] = useState<FingerprintInfo | null>(null);
  const [contextMenu, setContextMenu] = useState<TerminalContextMenuState | null>(null);
  const [completionView, setCompletionView] = useState<CompletionView>(HIDDEN_COMPLETIONS);
  const [pasteConfirm, setPasteConfirm] = useState<string | null>(null);
  const [terminalReady, setTerminalReady] = useState<boolean>(() => terminalInstances.has(tab.id));
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    completionSetters.set(tab.id, setCompletionView);
    return () => {
      completionSetters.delete(tab.id);
    };
  }, [tab.id]);

  const isSshBacked = useCallback((): boolean => {
    if (tab.type === 'ssh') return true;
    if (tab.type === 'docker') {
      const dsess = sessionsRef.current.find((s) => s.id === tab.sessionId);
      return (dsess?.docker_connect_method ?? '').toLowerCase() === 'ssh';
    }
    return false;
  }, [tab.sessionId, tab.type]);

  useEffect(() => {
    if (pasteConfirm === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPasteConfirm(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        terminalInstances.get(tab.id)?.terminal.paste(pasteConfirm);
        setPasteConfirm(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pasteConfirm, tab.id]);

  const copySelection = useCallback(() => {
    const terminal = terminalInstances.get(tab.id)?.terminal;
    if (!terminal) return;
    const selection = readTerminalSelection(terminal) || selectionSnapshotRef.current;
    if (selection) {
      void writeClipboardText(selection);
      terminal.clearSelection();
      selectionSnapshotRef.current = '';
    }
    terminal.focus();
    setContextMenu(null);
  }, [tab.id]);

  const maybePasteText = useCallback(
    (text: string) => {
      if (!text) return;
      if (useSettingsStore.getState().settings.pasteWarnMultiline && /[\r\n]/.test(text)) {
        setPasteConfirm(text);
      } else {
        terminalInstances.get(tab.id)?.terminal.paste(text);
      }
    },
    [tab.id],
  );

  const pasteClipboard = useCallback(() => {
    const terminal = terminalInstances.get(tab.id)?.terminal;
    if (!terminal) return;
    readClipboardText()
      .then((text) => {
        if (text) maybePasteText(text);
      })
      .catch(() => {});
    terminal.focus();
    setContextMenu(null);
  }, [tab.id, maybePasteText]);

  const selectAllTerminal = useCallback(() => {
    const inst = terminalInstances.get(tab.id);
    inst?.terminal.selectAll();
    inst?.terminal.focus();
    setContextMenu(null);
  }, [tab.id]);

  const clearTerminal = useCallback(() => {
    const inst = terminalInstances.get(tab.id);
    inst?.terminal.clear();
    inst?.terminal.focus();
    setContextMenu(null);
  }, [tab.id]);

  // Mount/reparent terminal instance & wire backend session lifecycle
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return mountTerminalSession({
      tab,
      container,
      sessionsRef,
      selectionSnapshotRef,
      fingerprintResolveRef,
      isSshBacked,
      maybePasteText,
      setContextMenu,
      setFingerprintInfo,
      setTerminalReady,
      t,
    });
    // Per-tab init: intentionally keyed only on tab identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.sessionId, tab.type]);

  // Native file drag-and-drop onto terminal pane (upload on SSH, quote path on local)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return attachTerminalDragDrop(tab, container, isVisibleRef, setDragOver);
  }, [tab]);

  useTerminalViewport({ containerRef, tab, theme, isActive, terminalReady, isSshBacked });

  return (
    <>
      <div
        ref={containerRef}
        className={`terminal-pane${broadcastInput ? ' broadcasting' : ''}${dragOver ? ' terminal-pane-drag-over' : ''}`}
        style={{ display: (visible ?? isActive) ? 'block' : 'none' }}
        onMouseDown={() => useAppStore.getState().setActiveTab(tab.id)}
      >
        <StickyScrollOverlay
          tabId={tab.id}
          fontFamily={terminalFont}
          fontSize={parseInt(terminalFontSize) || 13}
          enabled={terminalStickyScroll}
          terminalReady={terminalReady}
        />
      </div>

      {completionView.items.length > 0 &&
        isActive &&
        terminalCmdHint &&
        isInteractiveTerminal(tab.type) && (
          <CompletionDropdown
            view={completionView}
            fontFamily={terminalFont}
            fontSize={parseInt(terminalFontSize) || 13}
            onSelect={(idx) => {
              const item = completionView.items[idx];
              if (!item) return;
              const buf = lineTrackers.get(tab.id)?.buf ?? '';
              completionAccept.get(tab.id)?.(item.text.slice(buf.length));
              terminalInstances.get(tab.id)?.terminal.focus();
            }}
          />
        )}

      {contextMenu && isActive && (
        <TerminalContextMenu
          state={contextMenu}
          onCopy={copySelection}
          onPaste={pasteClipboard}
          onSelectAll={selectAllTerminal}
          onClear={clearTerminal}
        />
      )}

      {fingerprintInfo && isActive && (
        <FingerprintDialog
          info={fingerprintInfo}
          onAccept={() => {
            fingerprintResolveRef.current?.(true);
            setFingerprintInfo(null);
          }}
          onReject={() => {
            fingerprintResolveRef.current?.(false);
            setFingerprintInfo(null);
          }}
        />
      )}

      {pasteConfirm !== null && isActive && (
        <PasteConfirmDialog
          text={pasteConfirm}
          onCancel={() => setPasteConfirm(null)}
          onPaste={() => {
            const terminal = terminalInstances.get(tab.id)?.terminal;
            if (terminal) terminal.paste(pasteConfirm);
            setPasteConfirm(null);
          }}
        />
      )}
    </>
  );
};
