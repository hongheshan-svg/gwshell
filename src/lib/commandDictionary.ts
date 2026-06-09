/** Raw bilingual entry. Consumers should use lookupCommands() instead of accessing this directly. */
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

// Sorted once at module load; lookupCommands iterates this to return alphabetical results.
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
