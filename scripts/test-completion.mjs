#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const nodeRequire = createRequire(import.meta.url);

function loadTs(relativePath, requireMap = {}) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) =>
    specifier in requireMap ? requireMap[specifier] : nodeRequire(specifier);
  new Function('exports', 'require', 'module', js)(module.exports, localRequire, module);
  return module.exports;
}

// ---- commandDictionary ----
const dict = loadTs('src/lib/commandDictionary.ts');

const lMatches = dict.lookupCommands('ls', 'en').map((x) => x.cmd);
assert.ok(
  lMatches.includes('lsof') && lMatches.includes('lscpu') && lMatches.includes('lsblk'),
  'ls* commands are present for prefix "ls"'
);
assert.ok(!lMatches.includes('ls'), 'exact-length match is excluded (no empty suffix)');

assert.equal(dict.lookupCommands('lso', 'zh')[0]?.desc, '列出打开的文件', 'zh locale description');
assert.equal(dict.lookupCommands('lso', 'en')[0]?.desc, 'List open files', 'en locale description');

assert.deepEqual(dict.lookupCommands('', 'en'), [], 'empty prefix yields nothing');
assert.deepEqual(dict.lookupCommands('ls -', 'en'), [], 'prefix with whitespace yields nothing');

// results are alphabetically ordered by command name
const lsSorted = [...lMatches].sort((a, b) => a.localeCompare(b));
assert.deepEqual(lMatches, lsSorted, 'dictionary matches are alphabetical');

const gMatches = dict.lookupCommands('g', 'en').map((x) => x.cmd);
assert.ok(gMatches.length >= 4, 'g* returns multiple commands');
const gSorted = [...gMatches].sort((a, b) => a.localeCompare(b));
assert.deepEqual(gMatches, gSorted, 'g* matches are alphabetical');

console.log('commandDictionary tests passed');
