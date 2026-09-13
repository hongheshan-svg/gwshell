// src/lib/terminalClipboard.ts
// Clipboard read/write helpers and keyboard shortcut detection for the
// terminal. Extracted from TerminalView.tsx. The copy/paste shortcut
// detection depends on isMacPlatform() from terminalPlatform.ts.

import type { Terminal } from '@xterm/xterm';
import {
  readText as clipboardRead,
  writeText as clipboardWrite,
} from '@tauri-apps/plugin-clipboard-manager';
import { isMacPlatform } from './terminalPlatform';

// --- Paste action detection (right/middle-click menu) ---

const isPasteAction = (value: string) =>
  value === 'paste' || value === 'Paste' || value === '\u7c98\u8d34';

// --- Password prompt detection (used by render coalescing to suppress
// completions and history capture while the shell is asking for a password) ---

// Matches the tail of a terminal line that prompts for a secret. Covers
// English + Chinese prompts from sudo/su/mysql/ssh-keygen/passphrase/TOTP etc.
// Anchored to the end so a command like `echo password:` in earlier output
// doesn't trigger it unless it's actually the last thing printed. A short gap
// is allowed between the keyword and the colon so real prompts that interpose
// Matches the tail of a terminal line that prompts for a secret. Covers
// English + Chinese prompts from sudo/su/mysql/ssh-keygen/passphrase/TOTP etc.
// The keyword must be the last word-ish token before the colon (allowing only a
// short trailing qualifier like "for user"), so MOTD/banner/help lines that
// merely mention "password" don't trip it. Anchored to end-of-line.
const PASSWORD_PROMPT_RE =
  /(?:password|passphrase|passcode|verification code|密码|口令|密钥短语|验证码)(?:\s+for\s+\S+)?[:：]\s*$/i;

// --- Clipboard I/O (Tauri clipboard with browser fallback) ---

const writeClipboardText = async (text: string) => {
  const browserWrite = navigator.clipboard?.writeText(text).catch(() => {});
  await clipboardWrite(text).catch(() => browserWrite);
  const current = await clipboardRead().catch(() => '');
  if (current !== text) {
    await browserWrite;
    await clipboardWrite(text).catch(() => {});
  }
};

const readClipboardText = async () => {
  const tauriText = await clipboardRead().catch(() => undefined);
  if (typeof tauriText === 'string') return tauriText;
  return navigator.clipboard?.readText().catch(() => '') ?? '';
};

const readTerminalSelection = (terminal: Terminal) => {
  const selection = terminal.getSelection();
  return selection && selection.trim().length > 0 ? selection : '';
};

// --- Keyboard shortcut detection ---

const isCopyShortcut = (e: KeyboardEvent) => {
  const key = e.key.toLowerCase();
  const isKeyC = e.code === 'KeyC' || key === 'c';
  const isInsert = e.code === 'Insert' || key === 'insert';
  const isMac = isMacPlatform();

  if (isMac && e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && isKeyC) return true;
  if (!e.metaKey && e.ctrlKey && e.shiftKey && !e.altKey && isKeyC) return true;
  if (!isMac && !e.metaKey && e.ctrlKey && !e.shiftKey && !e.altKey && isKeyC) return true;
  return !e.metaKey && e.ctrlKey && !e.shiftKey && !e.altKey && isInsert;
};

const isPasteShortcut = (e: KeyboardEvent, ctrlVPaste: boolean) => {
  const key = e.key.toLowerCase();
  const isKeyV = e.code === 'KeyV' || key === 'v';
  const isInsert = e.code === 'Insert' || key === 'insert';
  const isMac = isMacPlatform();

  if (isMac && e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && isKeyV) return true;
  if (!e.metaKey && e.ctrlKey && e.shiftKey && !e.altKey && isKeyV) return true;
  if (!isMac && ctrlVPaste && !e.metaKey && e.ctrlKey && !e.shiftKey && !e.altKey && isKeyV)
    return true;
  return !e.metaKey && !e.ctrlKey && e.shiftKey && !e.altKey && isInsert;
};

export {
  PASSWORD_PROMPT_RE,
  isPasteAction,
  writeClipboardText,
  readClipboardText,
  readTerminalSelection,
  isCopyShortcut,
  isPasteShortcut,
};
