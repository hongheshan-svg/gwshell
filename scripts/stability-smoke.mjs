import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const tauriRoot = path.join(root, 'src-tauri', 'src');

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

console.log('GWShell stability smoke check');
console.log(`- frontend invokes scanned: ${frontendInvokeNames.length}`);
console.log(`- backend commands scanned: ${backendCommands.length}`);
console.log(`- settings store consumers: ok`);
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
