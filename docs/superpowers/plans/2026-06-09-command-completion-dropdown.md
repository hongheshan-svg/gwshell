# Command Completion Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GWShell's inline ghost-text command hint with a cursor-anchored completion dropdown that merges a built-in bilingual command dictionary with command history.

**Architecture:** Approach A — extend the existing per-tab overlay/key-handler machinery in `TerminalView.tsx`. Add two pure logic modules (`commandDictionary.ts`, `completion.ts`) tested with the repo's `scripts/*.mjs` + `loadTs()` convention, plus one presentational React component (`CompletionDropdown.tsx`). The existing `ghostText*` state, setter, and key handler are repurposed into completion equivalents.

**Tech Stack:** React + TypeScript, xterm.js, Zustand, i18next, lucide-react icons. No test runner — pure-logic tests are standalone Node scripts using `typescript`'s `transpileModule` (`loadTs` pattern from `scripts/test-auto-mode.mjs`); component/integration verified via `npm run build` (tsc), `npm run smoke:check`, and manual `npm run tauri dev`.

**Spec:** `docs/superpowers/specs/2026-06-09-command-completion-design.md`

**Branch:** `feature/command-completion-dropdown` (already created).

---

## File Structure

- **Create** `src/lib/commandDictionary.ts` — static command list + `lookupCommands(prefix, locale)`. One responsibility: the built-in dictionary.
- **Create** `src/lib/completion.ts` — `Completion` type + `buildCompletions()` merging history and dictionary. One responsibility: candidate assembly/ranking.
- **Create** `src/components/Terminal/CompletionDropdown.tsx` — presentational dropdown. One responsibility: render items at a position.
- **Create** `scripts/test-completion.mjs` — unit tests for the two logic modules.
- **Modify** `src/components/Terminal/TerminalView.tsx` — repurpose ghost state/setter/maps into completion; compute candidates in `onData`; render the dropdown; extend the key handler.
- **Modify** `src/styles/global.css` — dropdown styles; remove dead ghost-text styles.

---

## Task 1: Built-in command dictionary

**Files:**
- Create: `src/lib/commandDictionary.ts`
- Create (start): `scripts/test-completion.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-completion.mjs`:

```js
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

assert.equal(dict.lookupCommands('lsof', 'zh')[0]?.desc, '列出打开的文件', 'zh locale description');
assert.equal(dict.lookupCommands('lsof', 'en')[0]?.desc, 'List open files', 'en locale description');

assert.deepEqual(dict.lookupCommands('', 'en'), [], 'empty prefix yields nothing');
assert.deepEqual(dict.lookupCommands('ls -', 'en'), [], 'prefix with whitespace yields nothing');

// results are alphabetically ordered by command name
const lsSorted = [...lMatches].sort((a, b) => a.localeCompare(b));
assert.deepEqual(lMatches, lsSorted, 'dictionary matches are alphabetical');

console.log('commandDictionary tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-completion.mjs`
Expected: FAIL — `Cannot find module ...commandDictionary` / file does not exist.

- [ ] **Step 3: Write the dictionary module**

Create `src/lib/commandDictionary.ts`:

```ts
export interface CommandDef {
  cmd: string;
  en: string;
  zh: string;
}

// Common Linux/shell commands shown in the completion dropdown. Descriptions
// are kept short so they fit one row next to the command name.
export const COMMAND_DEFS: CommandDef[] = [
  { cmd: 'ls', en: 'List directory contents', zh: '列出目录内容' },
  { cmd: 'll', en: "Long-format listing (alias of 'ls -l')", zh: 'ls -l 的别名，长格式列出目录内容' },
  { cmd: 'la', en: "List all incl. hidden (alias of 'ls -A')", zh: 'ls -A 的别名，列出包含隐藏项' },
  { cmd: 'cd', en: 'Change the working directory', zh: '切换工作目录' },
  { cmd: 'pwd', en: 'Print working directory', zh: '显示当前目录' },
  { cmd: 'mkdir', en: 'Create directories', zh: '创建目录' },
  { cmd: 'rmdir', en: 'Remove empty directories', zh: '删除空目录' },
  { cmd: 'rm', en: 'Remove files or directories', zh: '删除文件或目录' },
  { cmd: 'cp', en: 'Copy files or directories', zh: '复制文件或目录' },
  { cmd: 'mv', en: 'Move or rename files', zh: '移动或重命名文件' },
  { cmd: 'touch', en: 'Create empty file / update timestamp', zh: '创建空文件或更新时间戳' },
  { cmd: 'ln', en: 'Create links between files', zh: '创建链接' },
  { cmd: 'find', en: 'Search for files in a directory tree', zh: '在目录树中查找文件' },
  { cmd: 'locate', en: 'Find files by name from an index', zh: '快速查找文件' },
  { cmd: 'tree', en: 'List directories as a tree', zh: '以树状列出目录' },
  { cmd: 'stat', en: 'Display file or filesystem status', zh: '显示文件状态' },
  { cmd: 'file', en: 'Determine file type', zh: '判断文件类型' },
  { cmd: 'realpath', en: 'Resolve absolute path', zh: '解析绝对路径' },
  { cmd: 'cat', en: 'Concatenate and print files', zh: '查看文件内容' },
  { cmd: 'tac', en: 'Print files in reverse', zh: '倒序查看文件内容' },
  { cmd: 'less', en: 'View file content page by page', zh: '分页显示文件内容' },
  { cmd: 'more', en: 'View file content page by page', zh: '分页显示文件内容' },
  { cmd: 'head', en: 'Output the first part of files', zh: '显示文件开头部分' },
  { cmd: 'tail', en: 'Output the last part of files', zh: '显示文件结尾部分' },
  { cmd: 'nl', en: 'Number lines of files', zh: '给文件内容加行号' },
  { cmd: 'wc', en: 'Count lines, words and bytes', zh: '统计行数、字数和字节数' },
  { cmd: 'cut', en: 'Remove sections from each line', zh: '按列截取文本' },
  { cmd: 'sort', en: 'Sort lines of text', zh: '排序文本行' },
  { cmd: 'uniq', en: 'Report or omit repeated lines', zh: '去除或统计重复行' },
  { cmd: 'diff', en: 'Compare files line by line', zh: '逐行比较文件' },
  { cmd: 'tee', en: 'Read stdin, write stdout and files', zh: '读取输入并同时写入文件' },
  { cmd: 'grep', en: 'Search text using patterns', zh: '按模式搜索文本' },
  { cmd: 'sed', en: 'Stream editor for text', zh: '流式文本编辑器' },
  { cmd: 'awk', en: 'Pattern scanning and processing', zh: '文本模式扫描与处理' },
  { cmd: 'xargs', en: 'Build command lines from stdin', zh: '从输入构建并执行命令' },
  { cmd: 'chmod', en: 'Change file mode bits', zh: '修改文件权限' },
  { cmd: 'chown', en: 'Change file owner and group', zh: '修改文件属主和属组' },
  { cmd: 'chgrp', en: 'Change group ownership', zh: '修改文件属组' },
  { cmd: 'umask', en: 'Set default permission mask', zh: '设置默认权限掩码' },
  { cmd: 'ps', en: 'Report running processes', zh: '查看进程状态' },
  { cmd: 'top', en: 'Live process/resource monitor', zh: '实时进程资源监控' },
  { cmd: 'htop', en: 'Interactive process viewer', zh: '交互式进程查看器' },
  { cmd: 'kill', en: 'Send a signal to a process', zh: '向进程发送信号' },
  { cmd: 'killall', en: 'Kill processes by name', zh: '按名称结束进程' },
  { cmd: 'pkill', en: 'Signal processes by pattern', zh: '按模式结束进程' },
  { cmd: 'pgrep', en: 'Look up processes by name', zh: '按名称查找进程' },
  { cmd: 'jobs', en: 'List active jobs', zh: '列出后台作业' },
  { cmd: 'nohup', en: 'Run a command immune to hangups', zh: '忽略挂断信号运行命令' },
  { cmd: 'free', en: 'Display memory usage', zh: '显示内存使用情况' },
  { cmd: 'uptime', en: 'Show how long the system has run', zh: '显示系统运行时间与负载' },
  { cmd: 'vmstat', en: 'Report virtual memory stats', zh: '报告虚拟内存统计' },
  { cmd: 'lsof', en: 'List open files', zh: '列出打开的文件' },
  { cmd: 'df', en: 'Report filesystem disk usage', zh: '显示磁盘空间使用' },
  { cmd: 'du', en: 'Estimate file space usage', zh: '统计目录占用空间' },
  { cmd: 'mount', en: 'Mount a filesystem', zh: '挂载文件系统' },
  { cmd: 'umount', en: 'Unmount a filesystem', zh: '卸载文件系统' },
  { cmd: 'lsblk', en: 'List block devices', zh: '列出所有可用块设备的信息' },
  { cmd: 'blkid', en: 'Show block device attributes', zh: '显示块设备属性' },
  { cmd: 'fdisk', en: 'Partition table manipulator', zh: '磁盘分区工具' },
  { cmd: 'lvm', en: 'Logical Volume Manager', zh: '逻辑卷管理' },
  { cmd: 'uname', en: 'Print system information', zh: '显示系统信息' },
  { cmd: 'hostname', en: 'Show or set the system name', zh: '显示或设置主机名' },
  { cmd: 'whoami', en: 'Print the current user name', zh: '显示当前用户名' },
  { cmd: 'id', en: 'Print user and group IDs', zh: '显示用户和组 ID' },
  { cmd: 'who', en: 'Show who is logged in', zh: '显示登录用户' },
  { cmd: 'lscpu', en: 'Display CPU architecture info', zh: '显示 CPU 架构信息' },
  { cmd: 'lsusb', en: 'List USB devices', zh: '列出 USB 设备' },
  { cmd: 'lspci', en: 'List PCI devices', zh: '列出 PCI 设备' },
  { cmd: 'dmesg', en: 'Print kernel ring buffer', zh: '查看内核日志' },
  { cmd: 'date', en: 'Show or set the system date', zh: '显示或设置系统时间' },
  { cmd: 'env', en: 'Show environment variables', zh: '显示环境变量' },
  { cmd: 'export', en: 'Set an environment variable', zh: '设置环境变量' },
  { cmd: 'history', en: 'Show command history', zh: '显示命令历史' },
  { cmd: 'alias', en: 'Define a command alias', zh: '定义命令别名' },
  { cmd: 'which', en: 'Locate a command', zh: '定位命令路径' },
  { cmd: 'whereis', en: 'Locate binary, source, manual', zh: '定位二进制/源码/手册' },
  { cmd: 'type', en: 'Describe how a name is resolved', zh: '说明命令类型' },
  { cmd: 'ping', en: 'Send ICMP echo requests', zh: '测试网络连通性' },
  { cmd: 'curl', en: 'Transfer data from/to a server', zh: '与服务器传输数据' },
  { cmd: 'wget', en: 'Download files from the web', zh: '从网络下载文件' },
  { cmd: 'ssh', en: 'OpenSSH remote login client', zh: '安全远程登录' },
  { cmd: 'scp', en: 'Secure copy over SSH', zh: '通过 SSH 安全复制' },
  { cmd: 'sftp', en: 'Secure file transfer over SSH', zh: '通过 SSH 安全传输文件' },
  { cmd: 'rsync', en: 'Fast incremental file transfer', zh: '增量同步文件' },
  { cmd: 'ss', en: 'Socket statistics', zh: '查看套接字状态' },
  { cmd: 'netstat', en: 'Network connections/stats', zh: '查看网络连接' },
  { cmd: 'ip', en: 'Show/manipulate routing & devices', zh: '查看与配置网络' },
  { cmd: 'ifconfig', en: 'Configure network interfaces', zh: '配置网络接口' },
  { cmd: 'dig', en: 'DNS lookup utility', zh: 'DNS 查询工具' },
  { cmd: 'nslookup', en: 'Query DNS records', zh: '查询 DNS 记录' },
  { cmd: 'nc', en: 'TCP/UDP networking utility', zh: 'TCP/UDP 网络工具' },
  { cmd: 'apt', en: 'Debian/Ubuntu package manager', zh: 'Debian/Ubuntu 包管理器' },
  { cmd: 'apt-get', en: 'Debian/Ubuntu package tool', zh: 'Debian/Ubuntu 包管理工具' },
  { cmd: 'dpkg', en: 'Debian package manager', zh: 'Debian 包管理器' },
  { cmd: 'yum', en: 'RHEL/CentOS package manager', zh: 'RHEL/CentOS 包管理器' },
  { cmd: 'dnf', en: 'Fedora package manager', zh: 'Fedora 包管理器' },
  { cmd: 'systemctl', en: 'Control systemd services', zh: '管理 systemd 服务' },
  { cmd: 'service', en: 'Run a System V init script', zh: '管理服务' },
  { cmd: 'journalctl', en: 'Query the systemd journal', zh: '查询 systemd 日志' },
  { cmd: 'tar', en: 'Archive files', zh: '打包/解包归档文件' },
  { cmd: 'gzip', en: 'Compress files', zh: '压缩文件' },
  { cmd: 'gunzip', en: 'Decompress .gz files', zh: '解压 .gz 文件' },
  { cmd: 'zip', en: 'Package and compress files', zh: '压缩为 zip' },
  { cmd: 'unzip', en: 'Extract zip archives', zh: '解压 zip 文件' },
  { cmd: 'vim', en: 'Vi IMproved text editor', zh: 'Vim 文本编辑器' },
  { cmd: 'nano', en: 'Simple terminal text editor', zh: '简易终端编辑器' },
  { cmd: 'git', en: 'Distributed version control', zh: '分布式版本控制' },
  { cmd: 'man', en: 'Display manual pages', zh: '查看手册页' },
  { cmd: 'echo', en: 'Display a line of text', zh: '输出一行文本' },
  { cmd: 'clear', en: 'Clear the terminal screen', zh: '清屏' },
  { cmd: 'exit', en: 'Exit the shell', zh: '退出当前 shell' },
  { cmd: 'sudo', en: 'Execute a command as another user', zh: '以其他用户身份执行命令' },
  { cmd: 'su', en: 'Switch user', zh: '切换用户' },
  { cmd: 'watch', en: 'Run a command periodically', zh: '周期性执行命令' },
  { cmd: 'crontab', en: 'Maintain cron schedules', zh: '管理定时任务' },
  { cmd: 'docker', en: 'Manage Docker containers', zh: '管理 Docker 容器' },
  { cmd: 'kubectl', en: 'Control Kubernetes clusters', zh: '管理 Kubernetes 集群' },
];

// Pre-sorted by command name so lookups return alphabetical results.
const SORTED = [...COMMAND_DEFS].sort((a, b) => a.cmd.localeCompare(b.cmd));

/**
 * Prefix-match the dictionary on the COMMAND NAME only.
 * Returns nothing when the prefix is empty or contains whitespace (the caller
 * is past the command name and into arguments, which the dictionary lacks).
 * Excludes exact-length matches so we never suggest an empty completion.
 */
export function lookupCommands(
  prefix: string,
  locale: 'en' | 'zh',
): { cmd: string; desc: string }[] {
  if (!prefix || /\s/.test(prefix)) return [];
  const out: { cmd: string; desc: string }[] = [];
  for (const d of SORTED) {
    if (d.cmd.startsWith(prefix) && d.cmd.length > prefix.length) {
      out.push({ cmd: d.cmd, desc: locale === 'zh' ? d.zh : d.en });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-completion.mjs`
Expected: PASS — prints `commandDictionary tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/commandDictionary.ts scripts/test-completion.mjs
git commit -m "feat(completion): add built-in bilingual command dictionary"
```

---

## Task 2: Candidate merge (`buildCompletions`)

**Files:**
- Create: `src/lib/completion.ts`
- Modify: `scripts/test-completion.mjs` (append)

- [ ] **Step 1: Write the failing test (append to `scripts/test-completion.mjs`)**

Append BEFORE the final nothing — i.e. add this block after the dictionary asserts and before no other code (the existing `console.log('commandDictionary tests passed')` stays; add a new section after it):

```js
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

console.log('completion tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-completion.mjs`
Expected: FAIL — `Cannot find module ...completion`.

- [ ] **Step 3: Write the module**

Create `src/lib/completion.ts`:

```ts
import { lookupCommands } from './commandDictionary';
import { getSuggestions, type SuggestCtx } from './commandHistory';

export type CompletionKind = 'history' | 'command';

export interface Completion {
  text: string; // full line text to complete to (replaces the current line)
  kind: CompletionKind;
  desc?: string; // localized description (command kind only)
}

/**
 * Merge history suggestions (ranked, full-line) with dictionary commands.
 * History ranks first; dictionary commands follow, deduped by text. Dictionary
 * is consulted only while the user is still typing the command name (no
 * whitespace in the line). Capped at `max`.
 */
export function buildCompletions(
  line: string,
  ctx: SuggestCtx,
  locale: 'en' | 'zh',
  max = 8,
): Completion[] {
  if (!line) return [];
  const out: Completion[] = [];
  const seen = new Set<string>();

  for (const cmd of getSuggestions(line, ctx)) {
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    out.push({ text: cmd, kind: 'history' });
    if (out.length >= max) return out;
  }

  if (!/\s/.test(line)) {
    for (const { cmd, desc } of lookupCommands(line, locale)) {
      if (seen.has(cmd)) continue;
      seen.add(cmd);
      out.push({ text: cmd, kind: 'command', desc });
      if (out.length >= max) return out;
    }
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-completion.mjs`
Expected: PASS — prints both `commandDictionary tests passed` and `completion tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/completion.ts scripts/test-completion.mjs
git commit -m "feat(completion): merge history and dictionary candidates"
```

---

## Task 3: Dropdown component + styles

**Files:**
- Create: `src/components/Terminal/CompletionDropdown.tsx`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Create the component**

Create `src/components/Terminal/CompletionDropdown.tsx`:

```tsx
import React from 'react';
import { Clock, SquareTerminal } from 'lucide-react';
import type { Completion } from '../../lib/completion';

interface CompletionDropdownProps {
  items: Completion[];
  selectedIndex: number;
  x: number;          // cursor cell column
  y: number;          // cursor cell row
  placeAbove: boolean; // render above the cursor instead of below
  fontFamily: string;
  fontSize: number;
}

export const CompletionDropdown: React.FC<CompletionDropdownProps> = ({
  items,
  selectedIndex,
  x,
  y,
  placeAbove,
  fontFamily,
  fontSize,
}) => {
  if (items.length === 0) return null;
  const style: React.CSSProperties = placeAbove
    ? { left: `calc(${x} * var(--cell-w))`, top: `calc(${y} * var(--cell-h))`, transform: 'translateY(-100%)' }
    : { left: `calc(${x} * var(--cell-w))`, top: `calc(${y + 1} * var(--cell-h))` };

  return (
    <div className="terminal-completion" style={style}>
      {items.map((it, i) => (
        <div
          key={`${it.kind}:${it.text}`}
          className={`terminal-completion-row${i === selectedIndex ? ' is-selected' : ''}`}
        >
          {it.kind === 'history' ? (
            <Clock className="terminal-completion-icon" size={13} />
          ) : (
            <SquareTerminal className="terminal-completion-icon" size={13} />
          )}
          <span className="terminal-completion-cmd" style={{ fontFamily, fontSize }}>
            {it.text}
          </span>
          {it.desc ? <span className="terminal-completion-desc">{it.desc}</span> : null}
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Add styles**

In `src/styles/global.css`, replace the ghost-text block (currently lines ~627-647, the `/* ---- Ghost text inline suggestion overlay ---- */` comment through the `[data-theme="light"] .terminal-ghost-text { ... }` rule) with:

```css
/* ---- Command completion dropdown ---- */
.terminal-completion {
  position: absolute;
  z-index: 20;
  min-width: 240px;
  max-width: 460px;
  max-height: calc(var(--cell-h) * 9);
  overflow-y: auto;
  padding: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  user-select: none;
}

.terminal-completion-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 5px;
  white-space: nowrap;
}

.terminal-completion-row.is-selected {
  background: var(--bg-hover);
}

.terminal-completion-icon {
  flex: 0 0 auto;
  color: var(--text-muted);
}

.terminal-completion-cmd {
  flex: 0 0 auto;
  color: var(--text-primary);
}

.terminal-completion-desc {
  flex: 1 1 auto;
  margin-left: 12px;
  text-align: right;
  color: var(--text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: PASS (tsc + vite build succeed). The new component compiles; `TerminalView.tsx` may still reference old ghost names until Task 4 — if so, this step is expected to surface those as the next task's work. If `npm run build` fails only due to the not-yet-removed ghost references in `TerminalView.tsx`, that is acceptable here; proceed to Task 4. If it fails due to an error inside `CompletionDropdown.tsx` or the CSS edit, fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/components/Terminal/CompletionDropdown.tsx src/styles/global.css
git commit -m "feat(completion): add dropdown component and styles"
```

---

## Task 4: Wire completion state into TerminalView (data + render)

This task repurposes the per-tab ghost maps/state/setter into completion equivalents and computes candidates in `onData`. The key handler is updated in Task 5.

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Add imports**

Near the existing imports (the block importing from `./blocks`, around line 17), add:

```ts
import { buildCompletions, type Completion } from '../../lib/completion';
import { CompletionDropdown } from './CompletionDropdown';
import i18n from '../../i18n';
```

(If `i18n` is already imported, skip that line.)

- [ ] **Step 2: Replace the per-tab module-level maps**

Find (around lines 165-176):

```ts
const ghostTextState       = new Map<string, string>();
const ghostTextSetters     = new Map<string, (text: string, x: number, y: number) => void>();
const ghostAcceptCallbacks = new Map<string, (suffix: string) => void>();
```
and
```ts
const tabCandidates     = new Map<string, string[]>();
const candidateIndex    = new Map<string, number>();
```

Replace them with:

```ts
const completionSetters    = new Map<string, (items: Completion[], index: number, x: number, y: number, above: boolean) => void>();
const completionAccept     = new Map<string, (suffix: string) => void>();
```
and
```ts
const tabCompletions    = new Map<string, Completion[]>();
const completionIndex   = new Map<string, number>();
const completionNav     = new Map<string, boolean>(); // user moved selection with ↑/↓
```

- [ ] **Step 3: Update cleanup deletions**

In `cleanupTabListeners` / the per-tab cleanup (around lines 248-256), replace the deletions of the old names:

```ts
  ghostTextState.delete(tabId);
  ghostTextSetters.delete(tabId);
  ghostAcceptCallbacks.delete(tabId);
```
and
```ts
  tabCandidates.delete(tabId);
  candidateIndex.delete(tabId);
```

with:

```ts
  completionSetters.delete(tabId);
  completionAccept.delete(tabId);
```
and
```ts
  tabCompletions.delete(tabId);
  completionIndex.delete(tabId);
  completionNav.delete(tabId);
```

- [ ] **Step 4: Replace the component state and setter registration**

Replace the setter-registration effect (around lines 366-374):

```ts
  useEffect(() => {
    ghostTextSetters.set(tab.id, (text, x, y) => {
      setGhostText(text);
      setGhostCursor({ x, y });
    });
    return () => {
      ghostTextSetters.delete(tab.id);
    };
  }, [tab.id]);
```

with:

```ts
  useEffect(() => {
    completionSetters.set(tab.id, (items, index, x, y, above) => {
      setCompletionItems(items);
      setCompletionIndex(index);
      setCompletionPos({ x, y, above });
    });
    return () => {
      completionSetters.delete(tab.id);
    };
  }, [tab.id]);
```

Replace the state declarations (around lines 378-379):

```ts
  const [ghostText, setGhostText] = useState('');
  const [ghostCursor, setGhostCursor] = useState({ x: 0, y: 0 });
```

with:

```ts
  const [completionItems, setCompletionItems] = useState<Completion[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [completionPos, setCompletionPos] = useState({ x: 0, y: 0, above: false });
```

- [ ] **Step 5: Rewrite `showGhost`/`clearGhost` in the `onData` handler**

In the `onData` handler (around lines 1083-1106), replace the `showGhost`/`clearGhost` definitions:

```ts
            let buf = inputBuffers.get(tab.id) ?? '';
            const setter = ghostTextSetters.get(tab.id);
            const inst = terminalInstances.get(tab.id);
            const cursorX = inst?.terminal.buffer.active.cursorX ?? 0;
            const cursorY = inst?.terminal.buffer.active.cursorY ?? 0;

            const showGhost = () => {
              if (st.cmdHintDeferToRemote && tabHasOsc133.get(tab.id)) {
                clearGhost();
                return;
              }
              const cands = commandHistory.getSuggestions(buf, { scope, cwd, sessionType });
              tabCandidates.set(tab.id, cands);
              candidateIndex.set(tab.id, 0);
              const suffix = cands[0] ? cands[0].slice(buf.length) : '';
              ghostTextState.set(tab.id, suffix);
              setter?.(suffix, cursorX, cursorY);
            };
            const clearGhost = () => {
              tabCandidates.set(tab.id, []);
              candidateIndex.set(tab.id, 0);
              ghostTextState.set(tab.id, '');
              setter?.('', 0, 0);
            };
```

with:

```ts
            let buf = inputBuffers.get(tab.id) ?? '';
            const setter = completionSetters.get(tab.id);
            const inst = terminalInstances.get(tab.id);
            const cursorX = inst?.terminal.buffer.active.cursorX ?? 0;
            const cursorY = inst?.terminal.buffer.active.cursorY ?? 0;
            const rows = inst?.terminal.rows ?? 24;
            const locale = i18n.language?.startsWith('zh') ? 'zh' : 'en';

            const showGhost = () => {
              if (st.cmdHintDeferToRemote && tabHasOsc133.get(tab.id)) {
                clearGhost();
                return;
              }
              const items = buildCompletions(buf, { scope, cwd, sessionType }, locale);
              tabCompletions.set(tab.id, items);
              completionIndex.set(tab.id, 0);
              completionNav.set(tab.id, false);
              const above = cursorY > rows - Math.min(items.length, 8) - 1;
              setter?.(items, 0, cursorX, cursorY, above);
            };
            const clearGhost = () => {
              tabCompletions.set(tab.id, []);
              completionIndex.set(tab.id, 0);
              completionNav.set(tab.id, false);
              setter?.([], 0, 0, 0, false);
            };
```

- [ ] **Step 6: Update the accept-callback registration**

Replace the ghost accept registration (around lines 1195-1210):

```ts
      if (isInteractiveTerminal(tab.type)) {
        ghostAcceptCallbacks.set(tab.id, (suffix: string) => {
```

with:

```ts
      if (isInteractiveTerminal(tab.type)) {
        completionAccept.set(tab.id, (suffix: string) => {
```

Inside that callback body, replace the two ghost-clearing lines:

```ts
          ghostTextState.set(tab.id, '');
          ghostTextSetters.get(tab.id)?.('', 0, 0);
```

with:

```ts
          tabCompletions.set(tab.id, []);
          completionIndex.set(tab.id, 0);
          completionNav.set(tab.id, false);
          completionSetters.get(tab.id)?.([], 0, 0, 0, false);
```

- [ ] **Step 7: Update the OSC-133 prompt reset (clear on new prompt)**

Find (around lines 1009-1012):

```ts
          tabCandidates.set(tab.id, []);
          candidateIndex.set(tab.id, 0);
          ghostTextState.set(tab.id, '');
          ghostTextSetters.get(tab.id)?.('', 0, 0);
```

Replace with:

```ts
          tabCompletions.set(tab.id, []);
          completionIndex.set(tab.id, 0);
          completionNav.set(tab.id, false);
          completionSetters.get(tab.id)?.([], 0, 0, 0, false);
```

- [ ] **Step 8: Replace the render block**

Replace the ghost-text JSX (around lines 1731-1743):

```tsx
      {ghostText && isActive && terminalCmdHint && isInteractiveTerminal(tab.type) && (
        <div
          className="terminal-ghost-text"
          style={{
            left: `calc(${ghostCursor.x} * var(--cell-w))`,
            top: `calc(${ghostCursor.y} * var(--cell-h))`,
            fontFamily: terminalFont,
            fontSize: terminalFontSize,
          }}
        >
          {ghostText}
        </div>
      )}
```

with:

```tsx
      {completionItems.length > 0 && isActive && terminalCmdHint && isInteractiveTerminal(tab.type) && (
        <CompletionDropdown
          items={completionItems}
          selectedIndex={completionIndex}
          x={completionPos.x}
          y={completionPos.y}
          placeAbove={completionPos.above}
          fontFamily={terminalFont}
          fontSize={terminalFontSize}
        />
      )}
```

(Note: the inner `style` object in the original may contain additional lines; replace the whole `{ghostText && ...}` expression including all of its `style` properties.)

- [ ] **Step 9: Type-check**

Run: `npm run build`
Expected: This will FAIL in the key handler (Task 5 not done) because it still references `ghostTextState` / `tabCandidates` / `ghostAcceptCallbacks`. That is expected. Confirm the ONLY remaining errors are in the `attachCustomKeyEventHandler` block (around lines 685-720). If errors appear elsewhere, fix them before Task 5.

- [ ] **Step 10: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx
git commit -m "feat(completion): drive dropdown state from input handler"
```

---

## Task 5: Key handling (navigate / accept / smart Enter)

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] **Step 1: Rewrite the completion block in `attachCustomKeyEventHandler`**

Replace the ghost-text key block (around lines 688-720), which currently is:

```ts
          // Ghost text: accept (Tab / →) or cycle candidates (↓ Ctrl-N / ↑ Ctrl-P).
          if (isInteractiveTerminal(tab.type)) {
            const ghost = ghostTextState.get(tab.id) ?? '';
            const cands = tabCandidates.get(tab.id) ?? [];
            const plainArrow = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;

            if (ghost && (e.key === 'Tab' || (e.key === 'ArrowRight' && plainArrow))) {
              e.preventDefault();
              ghostAcceptCallbacks.get(tab.id)?.(ghost);
              return false;
            }

            const cycleNext =
              (e.key === 'ArrowDown' && plainArrow) || (e.key === 'n' && e.ctrlKey);
            const cyclePrev =
              (e.key === 'ArrowUp' && plainArrow) || (e.key === 'p' && e.ctrlKey);
            if (ghost && (cycleNext || cyclePrev) && cands.length > 1) {
              e.preventDefault();
              const buf = inputBuffers.get(tab.id) ?? '';
              let idx = candidateIndex.get(tab.id) ?? 0;
              idx = cycleNext
                ? (idx + 1) % cands.length
                : (idx - 1 + cands.length) % cands.length;
              candidateIndex.set(tab.id, idx);
              const suffix = cands[idx].slice(buf.length);
              ghostTextState.set(tab.id, suffix);
              const inst = terminalInstances.get(tab.id);
              const cx = inst?.terminal.buffer.active.cursorX ?? 0;
              const cy = inst?.terminal.buffer.active.cursorY ?? 0;
              ghostTextSetters.get(tab.id)?.(suffix, cx, cy);
              return false;
            }
          }
```

with:

```ts
          // Completion dropdown: navigate (↑/↓/Ctrl-N/Ctrl-P), accept (Tab/→),
          // dismiss (Esc), smart Enter (accept only if the user navigated).
          if (isInteractiveTerminal(tab.type)) {
            const items = tabCompletions.get(tab.id) ?? [];
            const plainArrow = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;

            if (items.length > 0) {
              const idx = completionIndex.get(tab.id) ?? 0;
              const buf = inputBuffers.get(tab.id) ?? '';

              const accept = (i: number) => {
                e.preventDefault();
                completionAccept.get(tab.id)?.(items[i].text.slice(buf.length));
              };

              const repaint = (i: number) => {
                const inst = terminalInstances.get(tab.id);
                const cx = inst?.terminal.buffer.active.cursorX ?? 0;
                const cy = inst?.terminal.buffer.active.cursorY ?? 0;
                const rows = inst?.terminal.rows ?? 24;
                const above = cy > rows - Math.min(items.length, 8) - 1;
                completionSetters.get(tab.id)?.(items, i, cx, cy, above);
              };

              // Accept with Tab / →
              if (e.key === 'Tab' || (e.key === 'ArrowRight' && plainArrow)) {
                accept(idx);
                return false;
              }

              // Dismiss with Esc
              if (e.key === 'Escape') {
                e.preventDefault();
                tabCompletions.set(tab.id, []);
                completionIndex.set(tab.id, 0);
                completionNav.set(tab.id, false);
                completionSetters.get(tab.id)?.([], 0, 0, 0, false);
                return false;
              }

              // Navigate with ↑/↓ (or Ctrl-N/Ctrl-P)
              const next = (e.key === 'ArrowDown' && plainArrow) || (e.key === 'n' && e.ctrlKey);
              const prev = (e.key === 'ArrowUp' && plainArrow) || (e.key === 'p' && e.ctrlKey);
              if (next || prev) {
                e.preventDefault();
                const n = items.length;
                const ni = next ? (idx + 1) % n : (idx - 1 + n) % n;
                completionIndex.set(tab.id, ni);
                completionNav.set(tab.id, true);
                repaint(ni);
                return false;
              }

              // Smart Enter: accept the highlighted item only if the user has
              // actively navigated; otherwise fall through so the shell runs it.
              if (e.key === 'Enter' && completionNav.get(tab.id)) {
                accept(idx);
                return false;
              }
            }
          }
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: PASS — tsc and vite build succeed with no references to the removed `ghost*` symbols.

- [ ] **Step 3: Static smoke check**

Run: `npm run smoke:check`
Expected: PASS (no new failures vs. a clean tree).

- [ ] **Step 4: Re-run logic tests**

Run: `node scripts/test-completion.mjs`
Expected: PASS — both test sections still pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx
git commit -m "feat(completion): dropdown navigation, accept, and smart Enter"
```

---

## Task 6: Manual verification & cleanup

**Files:**
- Modify (if any dead references remain): `src/components/Terminal/TerminalView.tsx`, `src/styles/global.css`

- [ ] **Step 1: Grep for dead ghost symbols**

Run: `git grep -n "ghostText\|tabCandidates\|candidateIndex\|ghostAcceptCallbacks\|terminal-ghost-text"`
Expected: No matches in `src/`. If any remain (other than in the spec/plan docs), remove them.

- [ ] **Step 2: Build + smoke**

Run: `npm run build && npm run smoke:check && node scripts/test-completion.mjs`
Expected: all PASS.

- [ ] **Step 3: Manual verification in the running app**

Run: `npm run tauri dev`, connect an SSH session, and confirm:

1. Fresh session (no history): type `l` → dropdown shows dictionary entries (`la`, `less`, `ll`, `ln`, `locate`, `ls`, `lsblk`, `lscpu`, `lsof`, `lvm`, …) each with a description and the command icon.
2. Run a few commands (e.g. `ls -al`, `less /etc/hostname`); type `l` again → history entries appear first with the clock icon, deduped against the dictionary.
3. With the dropdown open: `↓`/`↑` move the highlight (and do NOT move the shell cursor / history); `Tab` or `→` inserts the highlighted command; `Esc` closes it.
4. Smart Enter: type `l` (do not press arrows) then `Enter` → the line executes normally. Type `l`, press `↓` to select an item, then `Enter` → the item is inserted and NOT executed; a second `Enter` runs it.
5. Dropdown closed (empty line or after accepting): `↑`/`↓` drive the shell's own history as before.
6. Toggle the terminal command-hint setting off → no dropdown appears.
7. Switch theme light/dark → panel, text, and selected-row colors look correct in both.
8. Place the cursor near the bottom of the terminal and trigger the dropdown → it renders above the cursor instead of being clipped.

- [ ] **Step 4: Final commit (only if Step 1 required edits)**

```bash
git add -A
git commit -m "chore(completion): remove dead ghost-text code"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** dictionary (Task 1), bilingual descriptions (Task 1 `lookupCommands` locale), history+dictionary merge with dedupe/cap and whitespace rule (Task 2), dropdown component with icons/theme/position/flip (Task 3 + Task 4 `above`), trigger gating reused (Task 4 keeps `terminalCmdHint`/`cmdHintDeferToRemote` and the `captureOn` gate), smart-Enter keybindings (Task 5), ghost removal (Task 6). All spec sections map to a task.
- **Placeholders:** none — every code step contains full content; the dictionary is a concrete list, not "add more".
- **Type consistency:** `Completion`/`CompletionKind` defined in Task 2 and consumed identically in Tasks 3-5; setter signature `(items, index, x, y, above)` is consistent across registration (Task 4 Step 4), `showGhost`/`clearGhost` (Step 5), accept/reset (Steps 6-7), and key handler (Task 5). `buildCompletions(line, ctx, locale, max)` and `lookupCommands(prefix, locale)` signatures match call sites.
```
