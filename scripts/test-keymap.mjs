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

const { parseBinding, matchStep, formatStep } = loadTs('src/keymap/match.ts');

const ctrlK = parseBinding('Ctrl+K');
assert.ok(ctrlK && ctrlK.length === 1, 'Ctrl+K parses to 1 step');
assert.equal(
  matchStep(
    { code: 'KeyK', key: 'k', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
    ctrlK[0],
  ),
  true,
  'Ctrl+K matches',
);
assert.equal(
  matchStep(
    { code: 'KeyK', key: 'k', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false },
    ctrlK[0],
  ),
  false,
  'Ctrl+Shift+K does not match Ctrl+K',
);

const agentToggle = parseBinding('Ctrl+Shift+A');
assert.ok(agentToggle && agentToggle.length === 1, 'Ctrl+Shift+A parses');
assert.equal(
  matchStep(
    { code: 'KeyA', key: 'A', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false },
    agentToggle[0],
  ),
  true,
  'Ctrl+Shift+A matches',
);
assert.equal(formatStep(agentToggle[0]), 'Ctrl+Shift+A', 'formatStep round-trips');

const chord = parseBinding('Ctrl+B N');
assert.ok(chord && chord.length === 2, '2-step chord parses');
assert.equal(parseBinding(''), null, 'empty binding rejected');

console.log('keymap tests passed');
