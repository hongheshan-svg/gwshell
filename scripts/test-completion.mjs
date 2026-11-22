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
  'ls* commands are present for prefix "ls"',
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

// unix is case-sensitive (accepting would append to the typed case: 'L' + 's')
assert.deepEqual(dict.lookupCommands('L', 'en', 'unix'), [], 'unix: case-sensitive');
assert.ok(
  dict.lookupCommands('get-c', 'en', 'powershell').some((x) => x.cmd === 'Get-ChildItem'),
  'powershell: case-insensitive',
);
assert.ok(
  dict.lookupCommands('DI', 'en', 'cmd').some((x) => x.cmd === 'dir'),
  'cmd: case-insensitive',
);

console.log('commandDictionary tests passed');

// ---- system-specific tables ----
const cmdMatches = dict.lookupCommands('d', 'en', 'cmd').map((x) => x.cmd);
assert.ok(
  cmdMatches.includes('dir') && cmdMatches.includes('del'),
  'cmd table has dir/del for "d"',
);
assert.ok(
  !cmdMatches.includes('df') && !cmdMatches.includes('du'),
  'cmd table excludes unix-only commands',
);

const psMatches = dict.lookupCommands('Get-', 'en', 'powershell').map((x) => x.cmd);
assert.ok(
  psMatches.includes('Get-ChildItem') && psMatches.includes('Get-Process'),
  'powershell table has Get-* cmdlets',
);
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

// ---- commandLine ----
const cl = loadTs('src/lib/commandLine.ts');

assert.deepEqual(cl.commandWordAt('gi'), { start: 0, word: 'gi' }, 'first word is a command');
assert.deepEqual(cl.commandWordAt(''), { start: 0, word: '' }, 'empty line expects a command');
assert.equal(cl.commandWordAt('git st'), null, 'arguments are not commands');
assert.equal(cl.commandWordAt('ls '), null, 'after a command, the next word is an argument');
assert.deepEqual(cl.commandWordAt('sudo sys'), { start: 5, word: 'sys' }, 'after sudo');
assert.deepEqual(cl.commandWordAt('ps aux | gr'), { start: 9, word: 'gr' }, 'after a pipe');
assert.deepEqual(cl.commandWordAt('make && np'), { start: 8, word: 'np' }, 'after &&');
assert.equal(cl.commandWordAt('make && ./ru'), null, 'paths are not dictionary words');
assert.deepEqual(cl.commandWordAt('echo $(da'), { start: 7, word: 'da' }, 'inside $(');
assert.deepEqual(cl.commandWordAt('FOO=1 ma'), { start: 6, word: 'ma' }, 'after an assignment');
assert.deepEqual(
  cl.commandWordAt('ls 2>&1 | gr'),
  { start: 10, word: 'gr' },
  '>& is a redirection',
);
assert.equal(cl.commandWordAt('sudo -u root sys'), null, 'wrapper options are not followed');
assert.equal(cl.commandWordAt('echo "a | gr'), null, 'inside a quote');
assert.equal(cl.commandWordAt("echo 'x' | g'r"), null, 'quoted word is not a command name');
assert.deepEqual(
  cl.commandNames('sudo docker ps -a | grep web && FOO=1 make'),
  ['sudo', 'docker', 'grep', 'make'],
  'command names across operators and wrappers',
);
assert.deepEqual(cl.commandNames('echo "a | b" ; ls'), ['echo', 'ls'], 'quotes hide operators');

console.log('commandLine tests passed');

// ---- commandHistory (ranking) ----
async function loadHistory(entries) {
  const h = loadTs('src/lib/commandHistory.ts', {
    '@tauri-apps/api/core': {
      invoke: (cmd) => Promise.resolve(cmd === 'get_command_history' ? entries : undefined),
    },
    './commandLine': cl,
  });
  await h.init(100);
  return h;
}
const now = Math.floor(Date.now() / 1000);
const entry = (command, scope, count = 1, extra = {}) => ({
  command,
  cwd: '',
  scope,
  session_type: 'ssh',
  count,
  last_used: now,
  ...extra,
});

{
  // the current host always ranks above other hosts, even very frequent ones
  const h = await loadHistory([
    entry('git push origin', 'other', 500),
    entry('git pull', 'here', 1),
  ]);
  assert.deepEqual(h.getSuggestions('git p', { scope: 'here' }), ['git pull', 'git push origin']);
}
{
  // within a host, the current directory gets a bonus
  const h = await loadHistory([
    entry('make test', 'here', 2, { cwd: '/b' }),
    entry('make build', 'here', 2, { cwd: '/a' }),
  ]);
  assert.equal(h.getSuggestions('make', { scope: 'here', cwd: '/a' })[0], 'make build');
}
{
  // unix history is case-sensitive; Windows tables are not, and fold duplicates
  const h = await loadHistory([
    entry('Get-ChildItem C:\\', 'w', 3),
    entry('get-childitem C:\\', 'w', 1),
    entry('Ls -al', 'w', 1),
  ]);
  assert.deepEqual(h.getSuggestions('ls', { table: 'unix' }), [], 'unix: case-sensitive');
  assert.deepEqual(
    h.getSuggestions('get-c', { table: 'powershell' }),
    ['Get-ChildItem C:\\'],
    'powershell: case-insensitive, one entry per spelling',
  );
}
{
  // usage counts every command-position word, weighted by count
  const h = await loadHistory([
    entry('sudo docker ps | grep web', 'x', 3),
    entry('docker images', 'x', 2),
  ]);
  const u = h.commandUsage();
  assert.equal(u.get('docker'), 5);
  assert.equal(u.get('grep'), 3);
  assert.equal(u.get('sudo'), 3);
  h.record('docker logs api', {});
  assert.equal(h.commandUsage().get('docker'), 6, 'record() updates usage');
}

console.log('commandHistory tests passed');

// ---- buildCompletions ----
function loadCompletion({ dict = () => [], history = () => [], usage = new Map() } = {}) {
  return loadTs('src/lib/completion.ts', {
    './commandDictionary': { lookupCommands: dict },
    './commandHistory': { getSuggestions: history, commandUsage: () => usage },
    './commandLine': cl,
  });
}

{
  const c = loadCompletion({
    dict: (p) =>
      p === 'ls'
        ? [
            { cmd: 'lsblk', desc: 'Block' },
            { cmd: 'lsof', desc: 'Open files' },
          ]
        : [],
    history: (p) => (p === 'ls' ? ['ls -al', 'ls /var/log'] : []),
  });
  const r = c.buildCompletions('ls', {}, 'en', 8);
  assert.equal(r[0].kind, 'history', 'history items rank first');
  assert.deepEqual(
    r.map((x) => x.text),
    ['ls -al', 'ls /var/log', 'lsof', 'lsblk'],
    'dictionary appended, shorter first when usage ties',
  );
  assert.equal(
    r.find((x) => x.text === 'lsof').desc,
    'Open files',
    'command item carries description',
  );
}

{
  // dictionary order follows personal usage
  const c = loadCompletion({
    dict: () => [
      { cmd: 'dd', desc: '' },
      { cmd: 'df', desc: '' },
      { cmd: 'docker', desc: '' },
    ],
    usage: new Map([['docker', 40]]),
  });
  assert.equal(c.buildCompletions('do', {}, 'en', 8)[0].text, 'docker');
}

{
  // a one-letter command prefix gets history only
  let asked = false;
  const c = loadCompletion({
    dict: () => {
      asked = true;
      return [{ cmd: 'ls', desc: '' }];
    },
    history: () => ['ls -al'],
  });
  const r = c.buildCompletions('l', {}, 'en', 8);
  assert.ok(!asked && r.every((x) => x.kind === 'history'), 'no dictionary for one letter');
}

{
  // dictionary completes the word in command position; text is the whole line
  const c = loadCompletion({
    dict: (p) =>
      p === 'sys'
        ? [{ cmd: 'systemctl', desc: '' }]
        : p === 'gr'
          ? [{ cmd: 'grep', desc: '' }]
          : [],
  });
  assert.deepEqual(c.buildCompletions('sudo sys', {}, 'en', 8)[0], {
    text: 'sudo systemctl',
    kind: 'command',
    desc: '',
  });
  assert.equal(c.buildCompletions('ps aux | gr', {}, 'en', 8)[0].text, 'ps aux | grep');
  assert.deepEqual(c.buildCompletions('git st', {}, 'en', 8), [], 'no dictionary for arguments');
}

{
  // dedupe: same text from history and dictionary appears once (history wins)
  const c = loadCompletion({ dict: () => [{ cmd: 'lsof', desc: 'd' }], history: () => ['lsof'] });
  const r = c.buildCompletions('ls', {}, 'en', 8);
  assert.equal(r.filter((x) => x.text === 'lsof').length, 1, 'no duplicate text');
  assert.equal(r.find((x) => x.text === 'lsof').kind, 'history', 'history wins dedupe');
}

{
  // history uses every slot the dictionary doesn't need
  const hist = Array.from({ length: 8 }, (_, i) => `git log -${i}`);
  const c = loadCompletion({ history: () => hist });
  assert.equal(c.buildCompletions('git', {}, 'en', 8).length, 8, 'history fills all 8');
  // ...and keeps the rest when the dictionary has matches
  const c2 = loadCompletion({
    history: () => hist,
    dict: () => [1, 2, 3, 4, 5, 6].map((n) => ({ cmd: `gitx${n}`, desc: '' })),
  });
  const r2 = c2.buildCompletions('git', {}, 'en', 8);
  assert.equal(r2.filter((x) => x.kind === 'history').length, 4, 'half for history');
  assert.equal(r2.length, 8);
}

{
  // cap respected
  const c = loadCompletion({ dict: () => [{ cmd: 'lsof', desc: '' }], history: () => ['ls -l'] });
  assert.equal(c.buildCompletions('ls', {}, 'en', 1).length, 1, 'max cap honored');
}

{
  // empty line -> nothing
  const c = loadCompletion();
  assert.deepEqual(c.buildCompletions('', {}, 'en', 8), [], 'empty line yields nothing');
}

{
  // buildCompletions forwards ctx.table to lookupCommands
  let receivedTable;
  const c = loadCompletion({
    dict: (prefix, _locale, table) => {
      receivedTable = table;
      return prefix === 'di' ? [{ cmd: 'dir', desc: 'List' }] : [];
    },
  });
  const r = c.buildCompletions('di', { table: 'cmd' }, 'en', 8);
  assert.equal(receivedTable, 'cmd', 'ctx.table is forwarded to lookupCommands');
  assert.ok(
    r.some((x) => x.kind === 'command' && x.text === 'dir'),
    'cmd dictionary result surfaces',
  );
}

console.log('completion tests passed');
