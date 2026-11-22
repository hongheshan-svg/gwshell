#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const nodeRequire = createRequire(import.meta.url);

function loadTs(rel, requireMap = {}) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const m = { exports: {} };
  new Function('exports', 'require', 'module', js)(
    m.exports,
    (s) => (s in requireMap ? requireMap[s] : nodeRequire(s)),
    m,
  );
  return m.exports;
}

const { extractTerminalCommands } = loadTs('src/lib/terminalAiCommands.ts');

// Extracts commands from shell code fences while ignoring comments
assert.deepEqual(
  extractTerminalCommands(
    [
      'Here are the steps:',
      '```bash',
      '# check disk usage',
      '$ df -hP /',
      'du -sh /var/log/*',
      '```',
    ].join('\n'),
  ),
  ['df -hP /', 'du -sh /var/log/*'],
  'shell code fence extraction',
);

// Ignores Markdown headings (# ...) and blockquotes (> ...) outside fences
assert.deepEqual(
  extractTerminalCommands(
    [
      '# Diagnosis Summary',
      '> Check the logs carefully before restarting nginx.',
      '## Next steps',
      '$ systemctl status nginx',
      'root@web01:/etc# journalctl -u nginx -n 20',
    ].join('\n'),
  ),
  ['systemctl status nginx', 'journalctl -u nginx -n 20'],
  'markdown headings and blockquotes must not be extracted as commands',
);

// Ignores non-shell code fences (json, python, yaml)
assert.deepEqual(
  extractTerminalCommands(
    [
      '```json',
      '{ "status": "ok" }',
      '```',
      '```python',
      '$ not_a_shell_command',
      'print("hi")',
      '```',
    ].join('\n'),
  ),
  [],
  'non-shell fences must not be scanned',
);

console.log('terminal AI command extraction tests passed');
