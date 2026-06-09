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
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const m = { exports: {} };
  new Function('exports', 'require', 'module', js)(m.exports, (s) => (s in requireMap ? requireMap[s] : nodeRequire(s)), m);
  return m.exports;
}
const { buildSplitPanes, clearSlot, fillFirstEmpty } = loadTs('src/lib/splitLayout.ts');

// buildSplitPanes: active first, then order, padded with null to length n
assert.deepEqual(buildSplitPanes(['a','b','c'], 'b', 4), ['b','a','c', null], 'active first + pad');
assert.deepEqual(buildSplitPanes(['a','b','c'], 'a', 2), ['a','b'], 'truncate to n');
assert.deepEqual(buildSplitPanes(['a'], 'a', 4), ['a', null, null, null], 'fewer tabs than n');
assert.deepEqual(buildSplitPanes([], null, 2), [null, null], 'no tabs');
assert.deepEqual(buildSplitPanes(['a','b'], 'zzz', 2), ['a','b'], 'active not in tabs -> plain order');

// clearSlot: null out a tab's slot, keep others
assert.deepEqual(clearSlot(['a','b',null], 'a'), [null,'b',null], 'clears matching slot');
assert.deepEqual(clearSlot(['a','b'], 'x'), ['a','b'], 'no match -> unchanged');

// fillFirstEmpty: put id in first null slot, else unchanged
assert.deepEqual(fillFirstEmpty(['a',null,null], 'b'), ['a','b',null], 'fills first null');
assert.deepEqual(fillFirstEmpty(['a','b'], 'c'), ['a','b'], 'no empty -> unchanged');
assert.deepEqual(fillFirstEmpty(['a','b'], 'a'), ['a','b'], 'already present -> unchanged');

console.log('split layout tests passed');
