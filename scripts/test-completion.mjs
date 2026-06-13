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

// ---- system-specific tables ----
const cmdMatches = dict.lookupCommands('d', 'en', 'cmd').map((x) => x.cmd);
assert.ok(cmdMatches.includes('dir') && cmdMatches.includes('del'), 'cmd table has dir/del for "d"');
assert.ok(!cmdMatches.includes('df') && !cmdMatches.includes('du'), 'cmd table excludes unix-only commands');

const psMatches = dict.lookupCommands('Get-', 'en', 'powershell').map((x) => x.cmd);
assert.ok(psMatches.includes('Get-ChildItem') && psMatches.includes('Get-Process'), 'powershell table has Get-* cmdlets');
assert.ok(
  dict.lookupCommands('ls', 'en', 'powershell').some((x) => x.cmd === 'ls') === false,
  'exact-length alias excluded',
);
assert.ok(
  dict.lookupCommands('l', 'en', 'powershell').some((x) => x.cmd === 'ls'),
  'powershell table includes the ls alias',
);

// default table is unix (back-compat with two-arg callers)
assert.deepEqual(
  dict.lookupCommands('ls', 'en').map((x) => x.cmd),
  dict.lookupCommands('ls', 'en', 'unix').map((x) => x.cmd),
  'omitting table defaults to unix',
);

// pure mappers
assert.equal(dict.tableForShellName('cmd'), 'cmd');
assert.equal(dict.tableForShellName('powershell'), 'powershell');
assert.equal(dict.tableForShellName('powershell7'), 'powershell');
assert.equal(dict.tableForShellName('bash'), 'unix');
assert.equal(dict.tableForShellName('wsl-Ubuntu'), 'unix');
assert.equal(dict.tableForShellName(undefined), 'unix');

assert.equal(dict.tableForRemoteShell('linux'), 'unix');
assert.equal(dict.tableForRemoteShell('cmd'), 'cmd');
assert.equal(dict.tableForRemoteShell('powershell'), 'powershell');
assert.equal(dict.tableForRemoteShell('auto'), null, 'auto means "probe needed"');
assert.equal(dict.tableForRemoteShell(undefined), null, 'unset means "probe needed"');

console.log('system-table tests passed');

// ---- buildCompletions ----
function loadCompletion(dictMatches, historyMatches) {
  return loadTs('src/lib/completion.ts', {
    './commandDictionary': {
      lookupCommands: (prefix, _locale) => (prefix === 'l' ? dictMatches : []),
    },
    './commandHistory': {
      getSuggestions: (prefix, _ctx) => (prefix === 'l' ? historyMatches : []),
    },
  });
}

{
  const c = loadCompletion(
    [{ cmd: 'ls', desc: 'List' }, { cmd: 'ln', desc: 'Link' }],
    ['ls -al', 'less notes.txt'],
  );
  const r = c.buildCompletions('l', {}, 'en', 8);
  assert.equal(r[0].kind, 'history', 'history items rank first');
  assert.equal(r[0].text, 'ls -al');
  assert.equal(r[1].text, 'less notes.txt');
  assert.ok(r.some((x) => x.kind === 'command' && x.text === 'ls'), 'dictionary appended');
  assert.ok(r.some((x) => x.kind === 'command' && x.text === 'ln'));
  assert.equal(
    r.find((x) => x.text === 'ls').desc,
    'List',
    'command item carries description',
  );
}

{
  // dedupe: same text from history and dictionary appears once (history wins)
  const c = loadCompletion([{ cmd: 'ls', desc: 'List' }], ['ls']);
  const r = c.buildCompletions('l', {}, 'en', 8);
  assert.equal(r.filter((x) => x.text === 'ls').length, 1, 'no duplicate text');
  assert.equal(r.find((x) => x.text === 'ls').kind, 'history', 'history wins dedupe');
}

{
  // cap respected
  const c = loadCompletion([{ cmd: 'ls', desc: 'd' }, { cmd: 'ln', desc: 'd' }], ['less x']);
  assert.equal(c.buildCompletions('l', {}, 'en', 1).length, 1, 'max cap honored');
}

{
  // cap when history is empty and dictionary overflows
  const c = loadCompletion([{ cmd: 'ls', desc: 'd' }, { cmd: 'ln', desc: 'd' }], []);
  assert.equal(c.buildCompletions('l', {}, 'en', 1).length, 1, 'cap on dictionary-only results');
}

{
  // whitespace in line -> dictionary skipped, history only
  const c = loadTs('src/lib/completion.ts', {
    './commandDictionary': { lookupCommands: () => [{ cmd: 'X', desc: 'd' }] },
    './commandHistory': { getSuggestions: () => ['git status'] },
  });
  const r = c.buildCompletions('git ', {}, 'en', 8);
  assert.ok(r.every((x) => x.kind === 'history'), 'no dictionary once past command name');
}

{
  // empty line -> nothing
  const c = loadCompletion([], []);
  assert.deepEqual(c.buildCompletions('', {}, 'en', 8), [], 'empty line yields nothing');
}

{
  // buildCompletions forwards ctx.table to lookupCommands
  let receivedTable;
  const c = loadTs('src/lib/completion.ts', {
    './commandDictionary': {
      lookupCommands: (prefix, _locale, table) => {
        receivedTable = table;
        return prefix === 'd' ? [{ cmd: 'dir', desc: 'List' }] : [];
      },
    },
    './commandHistory': { getSuggestions: () => [] },
  });
  const r = c.buildCompletions('d', { table: 'cmd' }, 'en', 8);
  assert.equal(receivedTable, 'cmd', 'ctx.table is forwarded to lookupCommands');
  assert.ok(r.some((x) => x.kind === 'command' && x.text === 'dir'), 'cmd dictionary result surfaces');
}

console.log('completion tests passed');
