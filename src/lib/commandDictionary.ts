/** Raw bilingual entry. Consumers should use lookupCommands() instead of accessing this directly. */
export interface CommandDef {
  cmd: string;
  en: string;
  zh: string;
}

// Common Linux/shell commands shown in the completion dropdown. Descriptions
// are kept short so they fit one row next to the command name.
export type CommandTable = 'unix' | 'cmd' | 'powershell';

export const UNIX_DEFS: CommandDef[] = [
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
  { cmd: 'export', en: 'Mark variables for export to child processes', zh: '将变量标记为环境变量' },
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

// Each table sorted once at module load (case-insensitive on the command name).
const SORTED: Record<CommandTable, CommandDef[]> = {
  unix: [...UNIX_DEFS].sort((a, b) => a.cmd.localeCompare(b.cmd)),
  cmd: [...CMD_DEFS].sort((a, b) => a.cmd.localeCompare(b.cmd)),
  powershell: [...POWERSHELL_DEFS].sort((a, b) => a.cmd.localeCompare(b.cmd)),
};

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
