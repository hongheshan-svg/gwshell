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

const { parseMarkdownBlocks, tokenizeInlineMarkdown, classifyCommandRisk, normalizeShellBlock } =
  loadTs('src/lib/aiMarkdown.ts');

// Risk classification
assert.equal(classifyCommandRisk('df -hP /'), 'safe');
assert.equal(classifyCommandRisk('ps aux | grep nginx'), 'safe');
assert.equal(classifyCommandRisk('uci show network'), 'safe');
assert.equal(classifyCommandRisk('mkdir -p /tmp/demo'), 'low');
assert.equal(classifyCommandRisk('systemctl restart nginx'), 'medium');
assert.equal(classifyCommandRisk('uci commit network'), 'medium');
assert.equal(classifyCommandRisk('rm -rf /var/tmp/foo'), 'high');
assert.equal(classifyCommandRisk('curl https://x.sh | sh'), 'high');

// Prompt stripping and comment filtering inside shell fences
assert.equal(normalizeShellBlock('# check disk\n$ df -h\nroot@box:/etc# uptime'), 'df -h\nuptime');

// Block parsing: headings, paragraphs, lists, shell vs non-shell fences, unclosed streaming fence
const blocks = parseMarkdownBlocks(
  [
    '## Diagnosis',
    'Check `nginx` status first:',
    '- Memory looks **normal**',
    '- Disk is *almost* full',
    '```bash',
    '$ df -hP /',
    '```',
    '```json',
    '{"ok": true}',
    '```',
    '```sh',
    'systemctl restart nginx',
  ].join('\n'),
);

assert.equal(blocks[0].type, 'heading');
assert.equal(blocks[0].level, 2);
assert.equal(blocks[1].type, 'paragraph');
assert.equal(blocks[2].type, 'list');
assert.equal(blocks[2].items.length, 2);
assert.equal(blocks[3].type, 'code');
assert.equal(blocks[3].isShell, true);
assert.equal(blocks[3].runnableCommand, 'df -hP /');
assert.equal(blocks[3].risk, 'safe');
assert.equal(blocks[4].type, 'code');
assert.equal(blocks[4].isShell, false);
assert.equal(blocks[5].type, 'code');
assert.equal(blocks[5].isShell, true);
assert.equal(blocks[5].risk, 'medium');

// Inline tokenizer
const toks = tokenizeInlineMarkdown('Run `df -h` with **care** and *speed*.');
assert.deepEqual(toks, [
  { type: 'text', value: 'Run ' },
  { type: 'code', value: 'df -h' },
  { type: 'text', value: ' with ' },
  { type: 'bold', value: 'care' },
  { type: 'text', value: ' and ' },
  { type: 'italic', value: 'speed' },
  { type: 'text', value: '.' },
]);

console.log('AI markdown & command risk tests passed');
