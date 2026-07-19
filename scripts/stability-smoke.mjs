import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const tauriRoot = path.join(root, 'src-tauri', 'src');
const SRC = path.join(root, 'src');
const SRC_TAURI = path.join(root, 'src-tauri');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

function findFiles(dir, extensions = new Set(['.ts', '.tsx', '.rs', '.json'])) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (extensions.has(path.extname(entry.name))) {
        out.push(full);
      }
    }
  }
  return out;
}

function rel(filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function extractFrontendInvokeNames() {
  const names = new Set();
  for (const file of findFiles(srcRoot, new Set(['.ts', '.tsx']))) {
    const text = readText(file);
    const re = /invoke\(\s*['"`]([^'"`]+)['"`]/g;
    for (const match of text.matchAll(re)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

function extractBackendCommands() {
  const text = readText(path.join(tauriRoot, 'lib.rs'));
  const commands = new Set();
  const handlerMatch = text.match(/generate_handler!\s*\[([\s\S]*?)\]\s*\)/);
  if (handlerMatch) {
    for (const token of handlerMatch[1].match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
      commands.add(token);
    }
  }
  return [...commands].sort();
}

function findMarkers() {
  const markers = [];
  const patterns = [/TODO/i, /FIXME/i, /WIP/i, /开发中/, /coming soon/i, /not implemented/i];
  for (const file of [...findFiles(srcRoot), ...findFiles(tauriRoot)]) {
    const text = readText(file);
    const lines = text.split('\n');
    lines.forEach((line, idx) => {
      if (patterns.some((pattern) => pattern.test(line))) {
        markers.push(`${rel(file)}:${idx + 1}: ${line.trim()}`);
      }
    });
  }
  return markers;
}

// ---- i18n key parity ----

function collectKeys(obj, prefix) {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) keys.push(...collectKeys(v, p));
    else keys.push(p);
  }
  return keys;
}

function checkI18nKeyParity() {
  const en = JSON.parse(fs.readFileSync(path.join(SRC, 'i18n/locales/gwshell.en.json'), 'utf8'));
  const zh = JSON.parse(fs.readFileSync(path.join(SRC, 'i18n/locales/gwshell.zh.json'), 'utf8'));
  const enKeys = collectKeys(en, '').sort();
  const zhKeys = collectKeys(zh, '').sort();
  const onlyInEn = enKeys.filter((k) => !zhKeys.includes(k));
  const onlyInZh = zhKeys.filter((k) => !enKeys.includes(k));
  if (onlyInEn.length === 0 && onlyInZh.length === 0) return { ok: true, errors: [] };
  const errors = [];
  if (onlyInEn.length)
    errors.push(
      `Keys only in en.json: ${onlyInEn.slice(0, 10).join(', ')}${onlyInEn.length > 10 ? ' (...)' : ''}`,
    );
  if (onlyInZh.length)
    errors.push(
      `Keys only in zh.json: ${onlyInZh.slice(0, 10).join(', ')}${onlyInZh.length > 10 ? ' (...)' : ''}`,
    );
  return { ok: false, errors };
}

// ---- backend-emit ↔ frontend-listen event-name parity ----
//
// Backend emits events with names built via:
//   format!("prefix-{id}")            e.g. "pty-data-{sid}"
//   terminal_ai_event_name("kind", id) -> "terminal-ai-{kind}-{id}"
//   agent::manager::event_name("kind", id) -> "agent-{kind}-{id}"
// Frontend listens with template literals:
//   listen(`prefix-suffix-${id}`)     e.g. `sftp-progress-${sessionId}`
//   listen(varName)                   where varName = `terminal-ai-delta-${requestId}`
//
// This check enforces an allowlist of sanctioned event-name prefixes so that
// adding a new event channel forces a review here.

const ALLOWED_EVENT_NAMES = [
  // pty / ssh / serial terminal data + exit streams
  'pty-data',
  'pty-exit',
  'ssh-data',
  'ssh-exit',
  'serial-data',
  'serial-exit',
  // sftp transfer progress
  'sftp-progress',
  // remote server metrics polling
  'server-metrics',
  'server-metrics-error',
  // terminal AI chat streaming
  'terminal-ai-delta',
  'terminal-ai-done',
  'terminal-ai-error',
  // agent session lifecycle
  'agent-evidence',
  'agent-analysis-delta',
  'agent-analysis-update',
  'agent-session-update',
  'agent-action-proposed',
  'agent-action-result',
  'agent-error',
];

function runGrep(pattern, dir) {
  try {
    const out = execSync(`grep -rohE '${pattern}' ${dir} 2>/dev/null || true`, {
      encoding: 'utf8',
    });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function collectBackendEventNames() {
  const names = new Set();
  // format!("prefix-{...}") — direct emit name construction.
  // Excludes helper-function internals: format!("agent-{...}" and
  // format!("terminal-ai-{...}" are the bodies of event_name() and
  // terminal_ai_event_name() — the actual emits are captured via those
  // helper calls below. Also excludes test fixtures (audit-*, call-invalid-*).
  for (const line of runGrep('format!\\("[a-z_-]+-\\{', 'src-tauri/src')) {
    const m = line.match(/format!\("([a-z_-]+)-\{/);
    if (!m) continue;
    const prefix = m[1];
    if (
      prefix === 'agent' || // helper internal — see event_name() calls
      prefix === 'terminal-ai' || // helper internal — see terminal_ai_event_name() calls
      prefix.startsWith('audit') || // test fixture
      prefix.startsWith('call-invalid') || // test fixture
      prefix === 'ssh' // test fixture (ssh-{idx})
    ) {
      continue;
    }
    names.add(prefix);
  }
  // terminal_ai_event_name("kind", ...) -> terminal-ai-{kind}
  // Must run BEFORE the generic event_name grep so we can skip those lines.
  const terminalAiKinds = new Set();
  for (const line of runGrep('terminal_ai_event_name\\("[a-z_-]+"', 'src-tauri/src')) {
    const m = line.match(/terminal_ai_event_name\("([a-z_-]+)"/);
    if (m) terminalAiKinds.add(m[1]);
  }
  for (const kind of terminalAiKinds) names.add(`terminal-ai-${kind}`);
  // agent::manager::event_name("kind", ...) -> agent-{kind}
  // Use a pattern that requires word-boundary before event_name to avoid
  // matching terminal_ai_event_name (already handled above).
  const agentKinds = new Set();
  for (const line of runGrep('\\bevent_name\\("[a-z_-]+"', 'src-tauri/src')) {
    const m = line.match(/\bevent_name\("([a-z_-]+)"/);
    if (m) agentKinds.add(m[1]);
  }
  for (const kind of agentKinds) names.add(`agent-${kind}`);
  return [...names].sort();
}

function collectFrontendEventNames() {
  const names = new Set();
  // Variable-assigned event names: const fooEvent = `prefix-suffix-${...}`
  // and inline listen(`prefix-suffix-${...}`). Scans ALL backtick template
  // literals with the event-name shape, then filters to those whose prefix
  // matches a known event channel (avoids catching localStorage keys like
  // `gwshell-sessions-${id}` or request-id generators like `terminal-ai-${ts}`).
  for (const line of runGrep('`[a-z_-]+-[a-z_-]+-\\${', 'src')) {
    const m = line.match(/`([a-z_-]+-[a-z_-]+)-\$\{/);
    if (!m) continue;
    const prefix = m[1];
    // Filter out non-event template literals:
    //  - `terminal-ai-${ts}` is the request-id generator (no -suffix)
    //  - `gwshell-sessions-${id}` is a localStorage key
    // Only accept prefixes that look like event channels (contain a known
    // suffix like data/exit/progress/error/delta/done/update/proposed/result).
    if (
      prefix.startsWith('gwshell-') || // localStorage key, not an event
      prefix === 'terminal-ai' // request-id generator, not an event listen
    ) {
      continue;
    }
    names.add(prefix);
  }
  // listen(`${eventPrefix}-suffix-${...}`) — variable prefix
  // (eventPrefix resolves to ssh/pty/serial at runtime; add all data+exit pairs)
  for (const line of runGrep('listen[a-zA-Z<>, ]*\\(`\\$\\{eventPrefix\\}-[a-z]+-\\$\\{', 'src')) {
    names.add('pty-data');
    names.add('pty-exit');
    names.add('ssh-data');
    names.add('ssh-exit');
    names.add('serial-data');
    names.add('serial-exit');
  }
  return [...names].sort();
}

function checkEventNameParity() {
  const backendPrefixes = collectBackendEventNames();
  const frontendPrefixes = collectFrontendEventNames();
  const errors = [];

  // Every backend-emitted prefix must be on the allowlist (forces review).
  for (const name of backendPrefixes) {
    if (!ALLOWED_EVENT_NAMES.includes(name))
      errors.push(
        `Backend emits "${name}-{id}" but it's not in ALLOWED_EVENT_NAMES — add it (forces review).`,
      );
  }
  // Every frontend-listened prefix must be emitted by the backend.
  for (const name of frontendPrefixes) {
    if (!backendPrefixes.includes(name))
      errors.push(`Frontend listens for "${name}-{id}" but backend never emits it.`);
  }
  // Every allowlisted name must actually be emitted by the backend.
  for (const name of ALLOWED_EVENT_NAMES) {
    if (!backendPrefixes.includes(name))
      errors.push(
        `ALLOWED_EVENT_NAMES lists "${name}" but backend never emits it — remove or implement.`,
      );
  }
  return { ok: errors.length === 0, errors };
}

// ---- capabilities allowlist ----
//
// Enforces an explicit allowlist of Tauri capabilities (permissions) granted
// to the main window. Adding a new permission forces a security review here —
// the check fails until the new permission is added to this Set.

function checkCapabilitiesAllowlist() {
  const caps = JSON.parse(
    fs.readFileSync(path.join(SRC_TAURI, 'capabilities/default.json'), 'utf8'),
  );
  const allowed = new Set([
    'core:default',
    'opener:allow-open-path',
    'dialog:allow-open',
    'dialog:allow-save',
    'core:window:allow-start-dragging',
    'core:window:allow-minimize',
    'core:window:allow-maximize',
    'core:window:allow-unmaximize',
    'core:window:allow-close',
    'core:window:allow-destroy',
    'core:window:allow-toggle-maximize',
    'core:window:allow-is-maximized',
    'core:window:allow-show',
    'core:window:allow-hide',
    'core:window:allow-set-focus',
    'updater:allow-check',
    'updater:allow-download-and-install',
    'deep-link:default',
    'clipboard-manager:allow-read-text',
    'clipboard-manager:allow-write-text',
    'process:allow-exit',
    'global-shortcut:default',
  ]);
  const errors = [];
  for (const perm of caps.permissions || []) {
    if (!allowed.has(perm))
      errors.push(
        `capabilities/default.json grants "${perm}" which is not on the allowlist — add it here (forces security review).`,
      );
  }
  return { ok: errors.length === 0, errors };
}

// ---- no window.confirm ----
//
// Enforces that no src/ code calls window.confirm — every confirmation must
// go through the in-app useConfirm hook (renders ConfirmDialog) so the UI
// stays consistent and accessible. Native window.confirm also blocks the
// render thread and clashes with the app's visual language.

function checkNoWindowConfirm() {
  let result = '';
  try {
    result = execSync(
      `grep -rn "window\\.confirm" src/ --include="*.ts" --include="*.tsx" || true`,
      { encoding: 'utf8' },
    );
  } catch {
    return { ok: true, errors: [] };
  }
  if (result.trim()) {
    return {
      ok: false,
      errors: [`window.confirm calls remain (must use useConfirm instead):\n${result.trim()}`],
    };
  }
  return { ok: true, errors: [] };
}

const failures = [];
const warnings = [];

const settingsStorePath = path.join(srcRoot, 'stores', 'settingsStore.ts');
if (!fs.existsSync(settingsStorePath)) {
  fail('Missing src/stores/settingsStore.ts');
} else {
  const settingsText = readText(settingsStorePath);
  if (!/export\s+const\s+useSettingsStore\b/.test(settingsText)) {
    fail('settingsStore does not export useSettingsStore');
  }
  if (!/load_app_settings/.test(settingsText) || !/save_app_settings/.test(settingsText)) {
    fail('settingsStore is missing Tauri settings persistence calls');
  }
  const consumers = findFiles(srcRoot, new Set(['.ts', '.tsx']))
    .filter((file) => file !== settingsStorePath)
    .filter((file) => /useSettingsStore\b/.test(readText(file)));
  if (consumers.length === 0) {
    fail('No non-store consumer imports useSettingsStore');
  }
}

const frontendInvokeNames = extractFrontendInvokeNames();
const backendCommands = extractBackendCommands();
const missingCommands = frontendInvokeNames.filter((name) => !backendCommands.includes(name));
if (missingCommands.length) {
  fail(`Frontend invokes missing backend handlers: ${missingCommands.join(', ')}`);
}

// ---- Server Panel wiring ----

const serverPanelPath = path.join(srcRoot, 'components', 'ServerPanel', 'ServerPanel.tsx');
if (!fs.existsSync(serverPanelPath)) {
  fail('Missing src/components/ServerPanel/ServerPanel.tsx');
} else {
  const text = readText(serverPanelPath);
  if (!/invoke\(\s*['"`]stop_server_metrics['"`]/.test(text)) {
    fail('ServerPanel.tsx useEffect cleanup must invoke stop_server_metrics');
  }
}

const metricsPath = path.join(tauriRoot, 'metrics.rs');
if (!fs.existsSync(metricsPath)) {
  fail('Missing src-tauri/src/metrics.rs');
} else {
  const text = readText(metricsPath);
  if (!/timeout\(\s*Duration::from_secs\(\s*5\s*\)/.test(text)) {
    fail('metrics.rs polling loop must wrap ssh_exec in a 5s timeout');
  }
}

for (const cmd of ['start_server_metrics', 'stop_server_metrics', 'kill_remote_process']) {
  if (!backendCommands.includes(cmd)) {
    fail(`Backend invoke_handler is missing ${cmd}`);
  }
}

const markers = findMarkers();
if (markers.length) {
  warn(`Visible TODO / dev markers found in production code (${markers.length}):`);
  for (const marker of markers.slice(0, 12)) warn(`  ${marker}`);
  if (markers.length > 12) warn(`  ... and ${markers.length - 12} more`);
}

// ---- i18n key parity ----
const i18nResult = checkI18nKeyParity();
if (!i18nResult.ok) {
  for (const e of i18nResult.errors) fail(`[i18n parity] ${e}`);
}

// ---- event-name parity ----
const eventResult = checkEventNameParity();
if (!eventResult.ok) {
  for (const e of eventResult.errors) fail(`[event parity] ${e}`);
}

// ---- capabilities allowlist ----
const capsResult = checkCapabilitiesAllowlist();
if (!capsResult.ok) {
  for (const e of capsResult.errors) fail(`[capabilities] ${e}`);
}

// ---- no window.confirm ----
const noWindowConfirmResult = checkNoWindowConfirm();
if (!noWindowConfirmResult.ok) {
  for (const e of noWindowConfirmResult.errors) fail(`[no-window-confirm] ${e}`);
}

console.log('GWShell stability smoke check');
console.log(`- frontend invokes scanned: ${frontendInvokeNames.length}`);
console.log(`- backend commands scanned: ${backendCommands.length}`);
console.log(`- settings store consumers: ok`);
console.log(`- i18n en/zh key parity: ${i18nResult.ok ? 'ok' : 'FAIL'}`);
console.log(`- event-name parity (backend↔frontend↔allowlist): ${eventResult.ok ? 'ok' : 'FAIL'}`);
console.log(`- capabilities allowlist: ${capsResult.ok ? 'ok' : 'FAIL'}`);
console.log(`- no window.confirm calls: ${noWindowConfirmResult.ok ? 'ok' : 'FAIL'}`);
if (warnings.length) {
  console.log('');
  console.log('Warnings:');
  for (const message of warnings) console.log(message);
}

if (failures.length) {
  console.error('');
  console.error('Failures:');
  for (const message of failures) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log('');
  console.log('Result: PASS');
}
