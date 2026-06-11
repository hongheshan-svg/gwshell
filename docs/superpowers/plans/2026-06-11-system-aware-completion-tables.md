# System-Aware Command Completion Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the command-completion dropdown pick its built-in dictionary (Unix / CMD / PowerShell) from the connected system instead of always serving Linux commands.

**Architecture:** Three command tables live in `commandDictionary.ts`; `lookupCommands` takes a `CommandTable`. The frontend resolves the table per tab — local shells from `shell_name`, docker/serial as `unix`, SSH from a per-asset `remote_shell` override or a one-shot backend probe (`detect_remote_os` invoke) that runs `uname -s` then `echo %COMSPEC%`. Detection result is stored in a per-tab map and passed into `buildCompletions`. Falls back to `unix` everywhere.

**Tech Stack:** React/TypeScript frontend (Zustand, xterm.js), Rust/Tauri 2 backend (russh). No runtime test suite — TS logic is checked by `node scripts/test-completion.mjs`, Rust by `cargo test`, and the whole app by `npm run build` + `npm run smoke:check`.

**Reference spec:** `docs/superpowers/specs/2026-06-11-system-aware-completion-tables-design.md`

> **Note on detection mechanism:** the spec described a `ssh-os-{id}` push event. This plan instead uses a request/response `detect_remote_os` invoke — the same outcome, but it avoids adding a second per-tab event listener (the codebase explicitly warns "only ONE set of event listeners per tab id" in `TerminalView.tsx`).

---

## File Structure

- `src/lib/commandDictionary.ts` (modify) — owns the three tables + `CommandTable` type + the `lookupCommands(prefix, locale, table)` selector + pure `tableForShellName` / `tableForRemoteShell` mappers.
- `src/lib/commandHistory.ts` (modify) — `SuggestCtx` gains an optional `table`.
- `src/lib/completion.ts` (modify) — passes the table to `lookupCommands`.
- `src-tauri/src/session.rs` (modify) — `remote_shell` field on `SessionConfig`.
- `src-tauri/src/ssh/probe.rs` (create) — pure `classify_command_table()` + unit tests.
- `src-tauri/src/ssh/mod.rs` (modify) — `mod probe;` + `detect_command_table()` orchestration.
- `src-tauri/src/lib.rs` (modify) — `detect_remote_os` command + handler registration.
- `src/types/index.ts` (modify) — `remote_shell` on the TS `SessionConfig`.
- `src/components/Modals/NewSessionModal.tsx` (modify) — "Remote shell" select in the SSH Advanced tab + save mapping.
- `src/i18n/locales/gwshell.en.json` + `gwshell.zh.json` (modify) — label + option strings (key-for-key).
- `src/components/Terminal/TerminalView.tsx` (modify) — `tabCommandTable` map, `syncTable()` helper, detection trigger, pass `table` into `buildCompletions`.
- `scripts/test-completion.mjs` (modify) — assertions for the new tables, mappers, and table threading.

---

## Task 1: Three command tables + `table` param in the dictionary

**Files:**
- Modify: `src/lib/commandDictionary.ts`
- Test: `scripts/test-completion.mjs`

- [ ] **Step 1: Add the failing tests to `scripts/test-completion.mjs`**

Insert the following block immediately after the existing line `console.log('commandDictionary tests passed');` (currently line 53):

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/test-completion.mjs`
Expected: FAIL — e.g. `TypeError: dict.tableForShellName is not a function` or an assertion error on the cmd table.

- [ ] **Step 3: Restructure `src/lib/commandDictionary.ts`**

Replace the file's header (the `CommandDef` interface through the `export const COMMAND_DEFS` declaration opener) so the existing Unix list is renamed to `UNIX_DEFS`. Concretely, change line 10 from:

```ts
export const COMMAND_DEFS: CommandDef[] = [
```

to:

```ts
export type CommandTable = 'unix' | 'cmd' | 'powershell';

export const UNIX_DEFS: CommandDef[] = [
```

Leave the ~120 existing Unix entries unchanged. Then **replace** the tail of the file — everything from the closing `];` of the old `COMMAND_DEFS` array (currently line 128) through the end — with:

```ts
];

// Windows CMD builtins and common console utilities.
export const CMD_DEFS: CommandDef[] = [
  { cmd: 'dir', en: 'List directory contents', zh: '列出目录内容' },
  { cmd: 'cd', en: 'Change the current directory', zh: '切换当前目录' },
  { cmd: 'chdir', en: 'Show or change the directory', zh: '显示或切换目录' },
  { cmd: 'cls', en: 'Clear the screen', zh: '清屏' },
  { cmd: 'copy', en: 'Copy files', zh: '复制文件' },
  { cmd: 'xcopy', en: 'Copy files and directory trees', zh: '复制文件和目录树' },
  { cmd: 'robocopy', en: 'Robust file/directory copy', zh: '强健的文件/目录复制' },
  { cmd: 'move', en: 'Move files', zh: '移动文件' },
  { cmd: 'ren', en: 'Rename files', zh: '重命名文件' },
  { cmd: 'rename', en: 'Rename files', zh: '重命名文件' },
  { cmd: 'del', en: 'Delete files', zh: '删除文件' },
  { cmd: 'erase', en: 'Delete files', zh: '删除文件' },
  { cmd: 'md', en: 'Create a directory', zh: '创建目录' },
  { cmd: 'mkdir', en: 'Create a directory', zh: '创建目录' },
  { cmd: 'rd', en: 'Remove a directory', zh: '删除目录' },
  { cmd: 'rmdir', en: 'Remove a directory', zh: '删除目录' },
  { cmd: 'type', en: 'Display file contents', zh: '显示文件内容' },
  { cmd: 'more', en: 'Display output one screen at a time', zh: '分页显示输出' },
  { cmd: 'tree', en: 'Show a directory tree', zh: '显示目录树' },
  { cmd: 'attrib', en: 'Show or change file attributes', zh: '显示或更改文件属性' },
  { cmd: 'find', en: 'Search for text in files', zh: '在文件中查找文本' },
  { cmd: 'findstr', en: 'Search for strings (regex)', zh: '按字符串/正则查找' },
  { cmd: 'where', en: 'Locate a program', zh: '定位程序路径' },
  { cmd: 'fc', en: 'Compare two files', zh: '比较两个文件' },
  { cmd: 'comp', en: 'Compare files byte by byte', zh: '逐字节比较文件' },
  { cmd: 'set', en: 'Show or set environment variables', zh: '显示或设置环境变量' },
  { cmd: 'setx', en: 'Set persistent environment variables', zh: '设置持久环境变量' },
  { cmd: 'echo', en: 'Display text', zh: '输出文本' },
  { cmd: 'path', en: 'Show or set the PATH', zh: '显示或设置 PATH' },
  { cmd: 'ipconfig', en: 'Show IP configuration', zh: '显示网络配置' },
  { cmd: 'ping', en: 'Test network connectivity', zh: '测试网络连通性' },
  { cmd: 'tracert', en: 'Trace the route to a host', zh: '路由跟踪' },
  { cmd: 'pathping', en: 'Trace route with packet-loss stats', zh: '路由与丢包分析' },
  { cmd: 'netstat', en: 'Show network connections', zh: '查看网络连接' },
  { cmd: 'nslookup', en: 'Query DNS records', zh: '查询 DNS 记录' },
  { cmd: 'route', en: 'Show or edit the routing table', zh: '查看或编辑路由表' },
  { cmd: 'arp', en: 'Show the ARP cache', zh: '显示 ARP 缓存' },
  { cmd: 'net', en: 'Manage network resources and services', zh: '管理网络资源与服务' },
  { cmd: 'sc', en: 'Manage Windows services', zh: '管理 Windows 服务' },
  { cmd: 'tasklist', en: 'List running processes', zh: '列出运行的进程' },
  { cmd: 'taskkill', en: 'Terminate processes', zh: '结束进程' },
  { cmd: 'systeminfo', en: 'Show system information', zh: '显示系统信息' },
  { cmd: 'hostname', en: 'Show the host name', zh: '显示主机名' },
  { cmd: 'whoami', en: 'Show the current user', zh: '显示当前用户' },
  { cmd: 'ver', en: 'Show the Windows version', zh: '显示系统版本' },
  { cmd: 'chkdsk', en: 'Check a disk for errors', zh: '检查磁盘错误' },
  { cmd: 'sfc', en: 'System file checker', zh: '系统文件检查' },
  { cmd: 'diskpart', en: 'Disk partition tool', zh: '磁盘分区工具' },
  { cmd: 'shutdown', en: 'Shut down or restart', zh: '关机或重启' },
  { cmd: 'assoc', en: 'Show file associations', zh: '显示文件关联' },
  { cmd: 'ftype', en: 'Show file-type commands', zh: '显示文件类型命令' },
  { cmd: 'reg', en: 'Registry command-line tool', zh: '注册表命令行工具' },
  { cmd: 'schtasks', en: 'Manage scheduled tasks', zh: '管理计划任务' },
  { cmd: 'wmic', en: 'WMI command-line', zh: 'WMI 命令行' },
  { cmd: 'powershell', en: 'Launch PowerShell', zh: '启动 PowerShell' },
  { cmd: 'title', en: 'Set the window title', zh: '设置窗口标题' },
  { cmd: 'color', en: 'Set console colors', zh: '设置控制台颜色' },
  { cmd: 'date', en: 'Show or set the date', zh: '显示或设置日期' },
  { cmd: 'time', en: 'Show or set the time', zh: '显示或设置时间' },
  { cmd: 'pause', en: 'Wait for a key press', zh: '等待按键' },
  { cmd: 'exit', en: 'Exit the command shell', zh: '退出命令行' },
];

// PowerShell cmdlets plus the Unix-style aliases that resolve in PowerShell.
export const POWERSHELL_DEFS: CommandDef[] = [
  { cmd: 'Get-ChildItem', en: 'List items (ls/dir)', zh: '列出目录项' },
  { cmd: 'Set-Location', en: 'Change directory (cd)', zh: '切换目录' },
  { cmd: 'Get-Location', en: 'Print working directory (pwd)', zh: '显示当前目录' },
  { cmd: 'Get-Content', en: 'Read a file (cat)', zh: '查看文件内容' },
  { cmd: 'Set-Content', en: 'Write file content', zh: '写入文件内容' },
  { cmd: 'Add-Content', en: 'Append to a file', zh: '追加到文件' },
  { cmd: 'Copy-Item', en: 'Copy items (cp)', zh: '复制项目' },
  { cmd: 'Move-Item', en: 'Move items (mv)', zh: '移动项目' },
  { cmd: 'Remove-Item', en: 'Delete items (rm)', zh: '删除项目' },
  { cmd: 'New-Item', en: 'Create a file or directory', zh: '新建文件或目录' },
  { cmd: 'Rename-Item', en: 'Rename an item', zh: '重命名项目' },
  { cmd: 'Get-Item', en: 'Get an item', zh: '获取项目' },
  { cmd: 'Test-Path', en: 'Test whether a path exists', zh: '测试路径是否存在' },
  { cmd: 'Get-Process', en: 'List processes (ps)', zh: '列出进程' },
  { cmd: 'Stop-Process', en: 'Stop a process (kill)', zh: '结束进程' },
  { cmd: 'Get-Service', en: 'List services', zh: '列出服务' },
  { cmd: 'Start-Service', en: 'Start a service', zh: '启动服务' },
  { cmd: 'Stop-Service', en: 'Stop a service', zh: '停止服务' },
  { cmd: 'Restart-Service', en: 'Restart a service', zh: '重启服务' },
  { cmd: 'Select-String', en: 'Search text (grep)', zh: '搜索文本' },
  { cmd: 'Where-Object', en: 'Filter objects', zh: '过滤对象' },
  { cmd: 'ForEach-Object', en: 'Iterate over objects', zh: '遍历对象' },
  { cmd: 'Select-Object', en: 'Select properties', zh: '选择属性' },
  { cmd: 'Sort-Object', en: 'Sort objects', zh: '排序对象' },
  { cmd: 'Measure-Object', en: 'Count and measure', zh: '统计度量' },
  { cmd: 'Get-Command', en: 'Find commands', zh: '查找命令' },
  { cmd: 'Get-Help', en: 'Show help', zh: '显示帮助' },
  { cmd: 'Get-Member', en: 'Show object members', zh: '显示对象成员' },
  { cmd: 'Write-Output', en: 'Send output to the pipeline', zh: '输出到管道' },
  { cmd: 'Write-Host', en: 'Write to the host', zh: '输出到主机' },
  { cmd: 'Out-File', en: 'Write output to a file', zh: '输出到文件' },
  { cmd: 'Clear-Host', en: 'Clear the screen (cls)', zh: '清屏' },
  { cmd: 'Get-Date', en: 'Get the date/time', zh: '获取日期时间' },
  { cmd: 'Invoke-WebRequest', en: 'HTTP request (curl/wget)', zh: '发起 HTTP 请求' },
  { cmd: 'Invoke-RestMethod', en: 'Call a REST API', zh: '调用 REST 接口' },
  { cmd: 'Test-Connection', en: 'Ping a host (ping)', zh: '测试网络连通' },
  { cmd: 'Get-NetIPAddress', en: 'Show IP addresses', zh: '显示 IP 地址' },
  { cmd: 'Get-NetTCPConnection', en: 'Show TCP connections', zh: '显示 TCP 连接' },
  { cmd: 'Set-ExecutionPolicy', en: 'Set the script execution policy', zh: '设置脚本执行策略' },
  { cmd: 'ls', en: 'List items (alias of Get-ChildItem)', zh: '列出目录（Get-ChildItem 别名）' },
  { cmd: 'dir', en: 'List items (alias of Get-ChildItem)', zh: '列出目录（Get-ChildItem 别名）' },
  { cmd: 'gci', en: 'Alias of Get-ChildItem', zh: 'Get-ChildItem 别名' },
  { cmd: 'cat', en: 'Read a file (alias of Get-Content)', zh: '查看文件（Get-Content 别名）' },
  { cmd: 'gc', en: 'Alias of Get-Content', zh: 'Get-Content 别名' },
  { cmd: 'cp', en: 'Copy (alias of Copy-Item)', zh: '复制（Copy-Item 别名）' },
  { cmd: 'cpi', en: 'Alias of Copy-Item', zh: 'Copy-Item 别名' },
  { cmd: 'mv', en: 'Move (alias of Move-Item)', zh: '移动（Move-Item 别名）' },
  { cmd: 'mi', en: 'Alias of Move-Item', zh: 'Move-Item 别名' },
  { cmd: 'rm', en: 'Delete (alias of Remove-Item)', zh: '删除（Remove-Item 别名）' },
  { cmd: 'ri', en: 'Alias of Remove-Item', zh: 'Remove-Item 别名' },
  { cmd: 'pwd', en: 'Working directory (alias of Get-Location)', zh: '当前目录（Get-Location 别名）' },
  { cmd: 'gl', en: 'Alias of Get-Location', zh: 'Get-Location 别名' },
  { cmd: 'cd', en: 'Change directory (alias of Set-Location)', zh: '切换目录（Set-Location 别名）' },
  { cmd: 'sl', en: 'Alias of Set-Location', zh: 'Set-Location 别名' },
  { cmd: 'cls', en: 'Clear the screen (alias of Clear-Host)', zh: '清屏（Clear-Host 别名）' },
  { cmd: 'clear', en: 'Clear the screen (alias of Clear-Host)', zh: '清屏（Clear-Host 别名）' },
  { cmd: 'echo', en: 'Output (alias of Write-Output)', zh: '输出（Write-Output 别名）' },
  { cmd: 'select', en: 'Alias of Select-Object', zh: 'Select-Object 别名' },
  { cmd: 'where', en: 'Filter (alias of Where-Object)', zh: '过滤（Where-Object 别名）' },
  { cmd: 'sort', en: 'Sort (alias of Sort-Object)', zh: '排序（Sort-Object 别名）' },
  { cmd: 'ps', en: 'Processes (alias of Get-Process)', zh: '进程（Get-Process 别名）' },
  { cmd: 'kill', en: 'Stop a process (alias of Stop-Process)', zh: '结束进程（Stop-Process 别名）' },
  { cmd: 'man', en: 'Show help (alias of Get-Help)', zh: '帮助（Get-Help 别名）' },
];

const TABLES: Record<CommandTable, CommandDef[]> = {
  unix: UNIX_DEFS,
  cmd: CMD_DEFS,
  powershell: POWERSHELL_DEFS,
};

// Each table sorted once at module load (case-insensitive on the command name).
const SORTED: Record<CommandTable, CommandDef[]> = {
  unix: [...UNIX_DEFS].sort((a, b) => a.cmd.localeCompare(b.cmd)),
  cmd: [...CMD_DEFS].sort((a, b) => a.cmd.localeCompare(b.cmd)),
  powershell: [...POWERSHELL_DEFS].sort((a, b) => a.cmd.localeCompare(b.cmd)),
};
void TABLES;

/** Map a local-shell `shell_name` to its command table. */
export function tableForShellName(shellName: string | null | undefined): CommandTable {
  switch (shellName) {
    case 'cmd':
      return 'cmd';
    case 'powershell':
    case 'powershell7':
      return 'powershell';
    default:
      return 'unix';
  }
}

/**
 * Map a per-asset `remote_shell` override to a table. Returns null for
 * 'auto'/unset, meaning the SSH probe should decide.
 */
export function tableForRemoteShell(remoteShell: string | null | undefined): CommandTable | null {
  switch (remoteShell) {
    case 'linux':
      return 'unix';
    case 'cmd':
      return 'cmd';
    case 'powershell':
      return 'powershell';
    default:
      return null;
  }
}

/**
 * Prefix-match the chosen table on the COMMAND NAME only.
 * Returns nothing when the prefix is empty or contains whitespace (the caller
 * is past the command name and into arguments, which the dictionary lacks).
 * Excludes exact-length matches so we never suggest an empty completion.
 */
export function lookupCommands(
  prefix: string,
  locale: 'en' | 'zh',
  table: CommandTable = 'unix',
): { cmd: string; desc: string }[] {
  if (!prefix || /\s/.test(prefix)) return [];
  const out: { cmd: string; desc: string }[] = [];
  for (const d of SORTED[table]) {
    if (d.cmd.startsWith(prefix) && d.cmd.length > prefix.length) {
      out.push({ cmd: d.cmd, desc: locale === 'zh' ? d.zh : d.en });
    }
  }
  return out;
}
```

Note: PowerShell command names are matched case-sensitively against the typed prefix (so `Get-` finds `Get-ChildItem`, and `ls` finds the lowercase alias) — this matches the existing `startsWith` behavior and needs no extra handling.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/test-completion.mjs`
Expected: PASS — prints `commandDictionary tests passed`, `system-table tests passed`, and `completion tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/commandDictionary.ts scripts/test-completion.mjs
git commit -m "feat(completion): add cmd and powershell command tables"
```

---

## Task 2: Thread the table through `buildCompletions`

**Files:**
- Modify: `src/lib/commandHistory.ts:12-16`
- Modify: `src/lib/completion.ts`
- Test: `scripts/test-completion.mjs`

- [ ] **Step 1: Add a failing test to `scripts/test-completion.mjs`**

Insert this block immediately before the final `console.log('completion tests passed');` line:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/test-completion.mjs`
Expected: FAIL — `receivedTable` is `undefined` because `completion.ts` calls `lookupCommands` with only two arguments.

- [ ] **Step 3: Add `table` to `SuggestCtx` in `src/lib/commandHistory.ts`**

Add the import at the top of the file (after the existing `import { invoke }` line):

```ts
import type { CommandTable } from './commandDictionary';
```

Then change the `SuggestCtx` interface (currently lines 12-16) to:

```ts
export interface SuggestCtx {
  scope?: string;
  cwd?: string;
  sessionType?: string;
  table?: CommandTable;
}
```

- [ ] **Step 4: Forward the table in `src/lib/completion.ts`**

Change the dictionary loop (currently line 40) from:

```ts
    for (const { cmd, desc } of lookupCommands(line, locale)) {
```

to:

```ts
    for (const { cmd, desc } of lookupCommands(line, locale, ctx.table ?? 'unix')) {
```

- [ ] **Step 5: Run to verify it passes**

Run: `node scripts/test-completion.mjs`
Expected: PASS — all three `*tests passed` lines print.

- [ ] **Step 6: Type-check**

Run: `npm run build`
Expected: TypeScript compiles with no errors (Vite build completes).

- [ ] **Step 7: Commit**

```bash
git add src/lib/commandHistory.ts src/lib/completion.ts scripts/test-completion.mjs
git commit -m "feat(completion): forward command table to lookupCommands"
```

---

## Task 3: Backend — `remote_shell` field, probe, and `detect_remote_os` command

**Files:**
- Modify: `src-tauri/src/session.rs:53` and `:139`
- Create: `src-tauri/src/ssh/probe.rs`
- Modify: `src-tauri/src/ssh/mod.rs:1-12` and method list
- Modify: `src-tauri/src/lib.rs` (after `kill_remote_process`, ~line 596; handler list ~line 1147)

- [ ] **Step 1: Create `src-tauri/src/ssh/probe.rs` with the classifier and its tests**

```rust
//! Remote-OS detection for command-completion table selection.
//!
//! `detect_command_table` runs at most two short exec probes on the live SSH
//! connection; `classify_command_table` is the pure decision function so it can
//! be unit-tested without a network.

/// Decide the completion table ("unix" | "cmd" | "powershell") from the stdout
/// of `uname -s` and `echo %COMSPEC%`.
///
/// - A recognizable POSIX kernel name from `uname -s` => "unix".
/// - Otherwise it is Windows: cmd.exe expands `%COMSPEC%` to a path containing
///   "cmd.exe"; PowerShell leaves the literal `%COMSPEC%` token intact.
/// - Anything ambiguous falls back to "unix" (today's behavior).
pub fn classify_command_table(uname_out: &str, comspec_out: &str) -> &'static str {
    let kernel = uname_out.trim().to_lowercase();
    if kernel.contains("linux")
        || kernel.contains("darwin")
        || kernel.contains("bsd")
        || kernel.contains("sunos")
        || kernel.contains("aix")
    {
        return "unix";
    }
    let comspec = comspec_out.to_lowercase();
    if comspec.contains("cmd.exe") {
        return "cmd";
    }
    if comspec.contains("%comspec%") {
        return "powershell";
    }
    "unix"
}

#[cfg(test)]
mod tests {
    use super::classify_command_table;

    #[test]
    fn linux_uname_wins() {
        assert_eq!(classify_command_table("Linux", ""), "unix");
        assert_eq!(classify_command_table("Darwin", ""), "unix");
        assert_eq!(classify_command_table("FreeBSD", ""), "unix");
    }

    #[test]
    fn windows_cmd_via_comspec() {
        assert_eq!(
            classify_command_table("", r"C:\WINDOWS\system32\cmd.exe"),
            "cmd"
        );
    }

    #[test]
    fn windows_powershell_literal_comspec() {
        // PowerShell echoes the unexpanded token.
        assert_eq!(classify_command_table("", "%COMSPEC%"), "powershell");
    }

    #[test]
    fn ambiguous_falls_back_to_unix() {
        assert_eq!(classify_command_table("", ""), "unix");
        assert_eq!(classify_command_table("garbage", "garbage"), "unix");
    }
}
```

- [ ] **Step 2: Run the probe test to verify it passes (compile + logic)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml classify`
Expected: the module currently isn't wired in, so this FAILS to find tests. That's expected — proceed to wire it up in the next step, then re-run.

- [ ] **Step 3: Register the module and add the orchestration in `src-tauri/src/ssh/mod.rs`**

Add the module declaration alongside the other `mod` lines (after `pub(crate) mod params;`, currently line 9):

```rust
mod probe;
```

Then add this method to the `impl SshManager` block, immediately after the existing `metrics_exec` method (currently ends at line 176):

```rust
    /// Probe the remote shell and return the completion table identifier
    /// ("unix" | "cmd" | "powershell"). Best-effort: any failure yields "unix".
    pub async fn detect_command_table(&self, session_id: &str) -> Result<String, String> {
        let uname = self
            .ssh_exec(session_id, "uname -s")
            .await
            .unwrap_or_default();
        // Short-circuit: a clear POSIX kernel needs no second probe.
        if probe::classify_command_table(&uname, "") == "unix" && !uname.trim().is_empty() {
            return Ok("unix".to_string());
        }
        let comspec = self
            .ssh_exec(session_id, "echo %COMSPEC%")
            .await
            .unwrap_or_default();
        Ok(probe::classify_command_table(&uname, &comspec).to_string())
    }
```

- [ ] **Step 4: Add the `remote_shell` field in `src-tauri/src/session.rs`**

After the `agent_forward` field (currently line 53), add:

```rust
    /// Manual override for command-completion table selection on SSH sessions:
    /// "auto" (or None) probes the remote, else "linux" | "cmd" | "powershell".
    pub remote_shell: Option<String>,
```

And in the `Default` impl, after `agent_forward: None,` (currently line 139), add:

```rust
            remote_shell: None,
```

- [ ] **Step 5: Add the `detect_remote_os` command in `src-tauri/src/lib.rs`**

Immediately after the `kill_remote_process` command (which ends at line 596), add:

```rust
#[tauri::command]
async fn detect_remote_os(
    session_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    state.ssh_manager.detect_command_table(&session_id).await
}
```

Then register it in the `tauri::generate_handler!` list by adding a line after `kill_remote_process,` (currently line 1147):

```rust
            detect_remote_os,
```

- [ ] **Step 6: Run the probe tests and build the backend**

Run: `cargo test --manifest-path src-tauri/Cargo.toml classify`
Expected: PASS — 4 tests in `ssh::probe::tests` pass.

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/ssh/probe.rs src-tauri/src/ssh/mod.rs src-tauri/src/session.rs src-tauri/src/lib.rs
git commit -m "feat(ssh): detect remote OS for completion table selection"
```

---

## Task 4: Manual override field in the asset editor + i18n

**Files:**
- Modify: `src/types/index.ts:45`
- Modify: `src/i18n/locales/gwshell.en.json` and `src/i18n/locales/gwshell.zh.json`
- Modify: `src/components/Modals/NewSessionModal.tsx:142` (save mapping) and `:681` (UI)

- [ ] **Step 1: Add `remote_shell` to the TS `SessionConfig`**

In `src/types/index.ts`, after the `agent_forward?: boolean;` line (currently line 45), add:

```ts
  // Command-completion table override for SSH: 'auto' probes the remote.
  remote_shell?: 'auto' | 'linux' | 'cmd' | 'powershell';
```

- [ ] **Step 2: Add i18n keys (both files, key-for-key)**

In `src/i18n/locales/gwshell.en.json`, after the `"ssh_agent_forward": ...` line (currently line 131), add:

```json
  "ssh_remote_shell": "Remote Shell (completion)",
  "ssh_remote_shell_auto": "Auto-detect",
  "ssh_remote_shell_linux": "Linux / Unix",
  "ssh_remote_shell_cmd": "Windows CMD",
  "ssh_remote_shell_powershell": "PowerShell",
```

In `src/i18n/locales/gwshell.zh.json`, find the matching `"ssh_agent_forward"` key and add immediately after it:

```json
  "ssh_remote_shell": "远程 Shell（自动补全）",
  "ssh_remote_shell_auto": "自动检测",
  "ssh_remote_shell_linux": "Linux / Unix",
  "ssh_remote_shell_cmd": "Windows CMD",
  "ssh_remote_shell_powershell": "PowerShell",
```

(If the `ssh_agent_forward` line is the last entry in an object, ensure commas remain valid JSON.)

- [ ] **Step 3: Save the field in `NewSessionModal.tsx` `buildConfig`**

After the `agent_forward: form.agent_forward || undefined,` line (currently line 142), add:

```tsx
      remote_shell: (form.remote_shell && form.remote_shell !== 'auto') ? form.remote_shell : undefined,
```

- [ ] **Step 4: Add the select to the Advanced tab UI**

In `NewSessionModal.tsx`, replace the agent-forward form row (currently lines 669-681) so a Remote-Shell select sits beside it. Change:

```tsx
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label style={{ visibility: 'hidden' }}>{t('common_placeholder')}</label>
                  <label className="ssh-toggle-label">
                    <input
                      type="checkbox"
                      checked={form.agent_forward || false}
                      onChange={(e) => setForm({ ...form, agent_forward: e.target.checked })}
                    />
                    <span>{t('ssh_agent_forward')}</span>
                  </label>
                </div>
              </div>
```

to:

```tsx
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label style={{ visibility: 'hidden' }}>{t('common_placeholder')}</label>
                  <label className="ssh-toggle-label">
                    <input
                      type="checkbox"
                      checked={form.agent_forward || false}
                      onChange={(e) => setForm({ ...form, agent_forward: e.target.checked })}
                    />
                    <span>{t('ssh_agent_forward')}</span>
                  </label>
                </div>
                <div className="ssh-form-group">
                  <label>{t('ssh_remote_shell')}</label>
                  <select
                    value={form.remote_shell || 'auto'}
                    onChange={(e) => setForm({ ...form, remote_shell: e.target.value as 'auto' | 'linux' | 'cmd' | 'powershell' })}
                  >
                    <option value="auto">{t('ssh_remote_shell_auto')}</option>
                    <option value="linux">{t('ssh_remote_shell_linux')}</option>
                    <option value="cmd">{t('ssh_remote_shell_cmd')}</option>
                    <option value="powershell">{t('ssh_remote_shell_powershell')}</option>
                  </select>
                </div>
              </div>
```

- [ ] **Step 5: Type-check the frontend**

Run: `npm run build`
Expected: compiles with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/i18n/locales/gwshell.en.json src/i18n/locales/gwshell.zh.json src/components/Modals/NewSessionModal.tsx
git commit -m "feat(ssh): add per-asset remote-shell override for completion"
```

---

## Task 5: Wire per-tab table selection + detection in `TerminalView.tsx`

**Files:**
- Modify: `src/components/Terminal/TerminalView.tsx` — imports (~line 28), per-tab maps (~line 181), `tabScope` neighborhood (~line 210), completion compute (~line 1207), reconnect teardown (~line 1521), SSH connect success (~line 1633), reconnect success (~line 1548).

- [ ] **Step 1: Import the table helpers and type**

Change the completion import (currently line 28) from:

```ts
import { buildCompletions, type Completion } from '../../lib/completion';
```

to:

```ts
import { buildCompletions, type Completion } from '../../lib/completion';
import { tableForShellName, tableForRemoteShell, type CommandTable } from '../../lib/commandDictionary';
```

- [ ] **Step 2: Add the per-tab table map**

After the `const bracketedPaste = new Map<string, boolean>();` line (currently line 181), add:

```ts
// Resolved completion table per tab. For SSH 'auto', filled in asynchronously
// by detect_remote_os; for other types it is derived synchronously (see syncTable).
const tabCommandTable = new Map<string, CommandTable>();
```

- [ ] **Step 3: Add the `syncTable` helper next to `tabScope`**

Immediately after the `tabScope` function (it ends around line 210, after the `serial`/default returns and closing brace), add:

```ts
// Synchronous best-guess completion table for a tab. SSH with an 'auto'/unset
// override returns 'unix' until the async probe (detect_remote_os) resolves and
// writes the real value into tabCommandTable.
function syncTable(
  type: string,
  session: { shell_name?: string; remote_shell?: string } | undefined,
): CommandTable {
  if (type === 'localshell') return tableForShellName(session?.shell_name);
  if (type === 'ssh') return tableForRemoteShell(session?.remote_shell) ?? 'unix';
  return 'unix'; // docker, serial
}

// Normalize a backend table string to a CommandTable (defensive against drift).
function normalizeTable(s: string): CommandTable {
  return s === 'cmd' || s === 'powershell' ? s : 'unix';
}
```

- [ ] **Step 4: Pass the table into `buildCompletions`**

Change the completion call (currently line 1207) from:

```ts
              const items = buildCompletions(buf, { scope, cwd, sessionType }, locale);
```

to:

```ts
              const table = tabCommandTable.get(tab.id) ?? syncTable(tab.type, sess);
              const items = buildCompletions(buf, { scope, cwd, sessionType, table }, locale);
```

(`sess` is already in scope here — it's resolved at the top of this block, currently line 1189.)

- [ ] **Step 5: Trigger detection after the initial SSH connect**

After `connectionReady = true;` in the SSH branch (currently line 1627), and after the OSC-133 injection block, add (place it right after the closing `}` of the `if (useSettingsStore...cmdHintShellIntegration)` block at ~line 1640):

```ts
            // Resolve the completion table: concrete override is synchronous;
            // 'auto'/unset triggers a one-shot remote probe (best-effort).
            if (tableForRemoteShell(session.remote_shell ?? null) === null) {
              invoke<string>('detect_remote_os', { sessionId: tab.sessionId })
                .then((tbl) => { tabCommandTable.set(tab.id, normalizeTable(tbl)); })
                .catch(() => {});
            }
```

- [ ] **Step 6: Re-detect on reconnect**

In the `reconnect` function, where stale per-tab state is cleared (after `inputBuffers.set(tab.id, '');`, currently line 1523), add:

```ts
        tabCommandTable.delete(tab.id);
```

Then, after the reconnect path marks the tab connected (`connectedTabs.add(tab.id);`, currently line 1548), add:

```ts
          if (tab.type === 'ssh' && freshSession && tableForRemoteShell(freshSession.remote_shell ?? null) === null) {
            invoke<string>('detect_remote_os', { sessionId: tab.sessionId })
              .then((tbl) => { tabCommandTable.set(tab.id, normalizeTable(tbl)); })
              .catch(() => {});
          }
```

- [ ] **Step 7: Clean up the map when a tab's terminal is torn down**

Find where per-tab maps are deleted on teardown (search the file for `inputBuffers.delete(` — it appears in the tab-cleanup path). Add alongside the other deletions:

```ts
    tabCommandTable.delete(tabId);
```

Use the same key variable (`tabId` or `tab.id`) that the surrounding deletions use. If `inputBuffers.delete` is not present, add `tabCommandTable.delete(tab.id);` next to where `connectedTabs.delete(tab.id)` is called during tab teardown.

- [ ] **Step 8: Type-check, smoke-check, and run completion tests**

Run: `npm run build`
Expected: compiles with no TypeScript errors.

Run: `npm run smoke:check`
Expected: the stability smoke scan reports no new issues.

Run: `node scripts/test-completion.mjs`
Expected: all `*tests passed` lines print.

- [ ] **Step 9: Commit**

```bash
git add src/components/Terminal/TerminalView.tsx
git commit -m "feat(completion): select command table per connected system"
```

---

## Task 6: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Launch the app**

Run: `npm run tauri dev`
Expected: app builds and opens.

- [ ] **Step 2: Verify each session type**

Ensure completion is enabled (Settings → terminal command hint; for local shells also enable "all sessions" so the dropdown shows outside SSH). Then check:

- Local **CMD** shell: type `d` → dropdown shows `dir`, `del` (not `ls`/`cat`).
- Local **PowerShell** shell: type `Get-` → shows `Get-ChildItem`, `Get-Process`; type `l` → shows the `ls` alias.
- Local **bash / Git Bash / WSL**: type `l` → shows `ls`, `lsof`, `lscpu` (Unix table, unchanged).
- **SSH → Linux**: unchanged (Unix table).
- **SSH → Windows** (if available): shortly after connect, typing `d` shows CMD/PowerShell entries. With no Windows host, set the asset's **Remote Shell** override to CMD or PowerShell and confirm the table switches without a probe.
- **Probe failure**: SSH to a Linux host with `uname` removed from PATH is rare; instead confirm that a normal Linux host still shows the Unix table (probe returns `unix`) and no error text appears in the terminal.

- [ ] **Step 3: Verify persistence of the override**

Edit an SSH asset, set Remote Shell = PowerShell, save, reopen the editor → the select still shows PowerShell. Restart the app → still PowerShell.

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

If Step 2-3 surfaced issues, fix them, re-run `npm run build` + `node scripts/test-completion.mjs`, and commit. Otherwise nothing to commit.

---

## Self-Review (completed by plan author)

- **Spec coverage:** three tables (Task 1); table threading (Task 2); `remote_shell` field + probe + command (Task 3); override UI + i18n (Task 4); per-tab selection + detection wiring (Task 5); manual checks (Task 6). All spec sections map to a task.
- **Type consistency:** `CommandTable = 'unix' | 'cmd' | 'powershell'` defined in Task 1 and imported in Tasks 2 & 5; `lookupCommands(prefix, locale, table)` 3-arg signature consistent across Tasks 1, 2, and the test; `detect_remote_os` (command) ↔ `detect_command_table` (manager method) ↔ `classify_command_table` (pure fn) used consistently in Task 3 and called in Task 5; `tableForShellName`/`tableForRemoteShell`/`normalizeTable`/`syncTable` names consistent across Tasks 1 and 5.
- **Placeholder scan:** no TBD/TODO; all code steps show full code.
- **Mechanism note:** detection uses a request/response invoke rather than the spec's event, documented at the top of this plan.
