import type { Terminal, IDisposable } from '@xterm/xterm';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../i18n';
import type { TabInfo } from '../../types';
import type { AutoModeDetectionContext, AutoModeMatchResult } from '../../types';
import { useAutoModeStore } from '../../stores/autoModeStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { getAllRules } from './autoModeRules';

const IDLE_DEBOUNCE_MS = 200;
const USER_INPUT_SUPPRESS_MS = 800;
const ANTI_DOUBLE_FIRE_MS = 500;

export class AutoModeWatcher {
  private tabId: string;
  private sessionId: string;
  private tabType: TabInfo['type'];
  private terminal: Terminal;

  private writeParsedDispose: IDisposable | null = null;
  private dataDispose: IDisposable | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private lastWriteAt = 0;
  private lastUserInputAt = 0;
  private lastInjectionAt = 0;
  private lastAltScreen = false;
  private recentTriggers: number[] = [];
  private disposed = false;

  constructor(params: {
    tabId: string;
    sessionId: string;
    tabType: TabInfo['type'];
    terminal: Terminal;
  }) {
    this.tabId = params.tabId;
    this.sessionId = params.sessionId;
    this.tabType = params.tabType;
    this.terminal = params.terminal;
  }

  start(): void {
    if (this.writeParsedDispose || this.dataDispose) return;

    // onWriteParsed fires after xterm has parsed a write (ANSI processed, buffer updated).
    this.writeParsedDispose = this.terminal.onWriteParsed(() => {
      if (this.disposed) return;
      this.lastWriteAt = Date.now();

      // Detect alt-screen exit: write a summary line to scrollback once.
      const nowAlt = this.terminal.buffer.active.type === 'alternate';
      if (this.lastAltScreen && !nowAlt) {
        this.writeAltScreenExitSummary();
      }
      this.lastAltScreen = nowAlt;

      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.tryDetect();
      }, IDLE_DEBOUNCE_MS);
    });

    // onData fires on user keypress (before it is sent to the backend).
    this.dataDispose = this.terminal.onData(() => {
      if (this.disposed) return;
      this.lastUserInputAt = Date.now();
      // A user keypress cancels any pending detection: the user is interacting.
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    try { this.writeParsedDispose?.dispose(); } catch {}
    try { this.dataDispose?.dispose(); } catch {}
    this.writeParsedDispose = null;
    this.dataDispose = null;
    useAutoModeStore.getState().cleanup(this.tabId);
  }

  private tryDetect(): void {
    try {
      const store = useAutoModeStore.getState();
      if (!store.enabled[this.tabId]) return;

      const now = Date.now();
      if (now - this.lastInjectionAt < ANTI_DOUBLE_FIRE_MS) return;
      if (now - this.lastUserInputAt < USER_INPUT_SUPPRESS_MS) return;

      const buf = this.terminal.buffer.active;
      const inAltScreen = buf.type === 'alternate';
      if (!inAltScreen) return;  // hard gate: only detect inside alt-screen TUIs

      // Read the visible viewport lines (top→bottom), stripped of trailing whitespace.
      const lines: string[] = [];
      const start = buf.viewportY;
      const end = start + this.terminal.rows;
      for (let y = start; y < end; y++) {
        const line = buf.getLine(y);
        lines.push(line ? line.translateToString(true) : '');
      }

      const ctx: AutoModeDetectionContext = {
        visibleLines: lines,
        cursorRow: buf.cursorY,
        cursorCol: buf.cursorX,
        inAltScreen,
        idleMs: now - this.lastWriteAt,
        lastUserInputAt: this.lastUserInputAt,
        now,
      };

      const settings = useSettingsStore.getState().settings;
      const rules = getAllRules(settings.autoModeCustomRules);

      for (const rule of rules) {
        let result: AutoModeMatchResult | null = null;
        try {
          result = rule.match(ctx);
        } catch (err) {
          useAutoModeStore.getState().pushLog(this.tabId, {
            time: now,
            kind: 'error',
            label: i18n.t('auto_mode_log_rule_error', { rule: rule.name, error: String(err) }),
          });
          continue;
        }
        if (result) {
          this.fire(result, now);
          return;
        }
      }
    } catch (err) {
      useAutoModeStore.getState().pushLog(this.tabId, {
        time: Date.now(),
        kind: 'error',
        label: `watcher error: ${String(err)}`,
      });
    }
  }

  private fire(result: AutoModeMatchResult, now: number): void {
    this.lastInjectionAt = now;

    const store = useAutoModeStore.getState();
    store.pushLog(this.tabId, {
      time: now,
      kind: 'info',
      label: result.label,
      ruleName: result.ruleName,
      response: result.response,
    });
    store.incrementCounter(this.tabId);

    // Cooldown bookkeeping
    this.recordTrigger(now);

    // Inject through the same IPC path TerminalView.onData uses.
    const writeCmd = this.tabType === 'ssh' ? 'write_to_ssh' : 'write_to_pty';
    invoke(writeCmd, { sessionId: this.sessionId, data: result.response }).catch((err) => {
      useAutoModeStore.getState().pushLog(this.tabId, {
        time: Date.now(),
        kind: 'error',
        label: i18n.t('auto_mode_log_send_failed', { error: String(err) }),
      });
    });
  }

  private recordTrigger(now: number): void {
    const settings = useSettingsStore.getState().settings;
    const win = settings.autoModeCooldownWindowMs;
    const cap = settings.autoModeCooldownCount;
    this.recentTriggers.push(now);
    while (this.recentTriggers.length && this.recentTriggers[0] < now - win) {
      this.recentTriggers.shift();
    }
    if (this.recentTriggers.length > cap) {
      const store = useAutoModeStore.getState();
      store.setEnabled(this.tabId, false);
      store.pushLog(this.tabId, {
        time: now,
        kind: 'warning',
        label: i18n.t('auto_mode_log_cooldown_tripped'),
      });
      this.recentTriggers = [];
    }
  }

  private writeAltScreenExitSummary(): void {
    const count = useAutoModeStore.getState().counters[this.tabId] ?? 0;
    if (count === 0) return;
    const msg = i18n.t('auto_mode_session_summary', { count });
    try {
      this.terminal.write(`\r\n\x1b[90m${msg}\x1b[0m\r\n`);
    } catch {}
  }
}
