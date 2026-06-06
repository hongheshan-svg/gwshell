# Phase 3c-2 设计:远程转发 + 动态 SOCKS(后端)

- 日期:2026-06-06 · 纯 Rust(+少量前端)· **cargo 验编译;运行时需真实 SSH 服务器验证(用户自验)**

## 现状
- `forward.rs::start_local` 用 `conn.channel_open_direct_tcpip` 桥接(已验证模式)。`SshManager.forwards: Mutex<HashMap<String, Arc<Notify>>>` 存停止信号。`lib.rs::start_tunnel` **总是**调 `start_local_forward`,忽略 `tunnel_type`。前端 `tunnel_type='remote'` 已存但后端死。

## 设计
1. **动态 SOCKS5**(自包含,复用 direct-tcpip 桥):`forward::start_socks(conn, local_port, stop) -> Result<u16>` —— 绑 127.0.0.1:port;每连接做 SOCKS5 无认证握手;解析 CONNECT(ATYP 1=IPv4/3=域名/4=IPv6 + 端口);`channel_open_direct_tcpip(target_host, target_port, "127.0.0.1", 0)`;回成功;双向桥接(复用 start_local 的 select bridge)。`SshManager` 加 `socks: Mutex<HashMap<String, Arc<Notify>>>` + `start_socks_forward`/`close` + 在 close_ssh 清理。
2. **远程转发**(`tcpip_forward`):`forward::start_remote(...)` —— `conn.tcpip_forward(&bind_addr, remote_port)` 让服务端监听;服务端回的 forwarded-tcpip channel 到达 `handler.rs` Client 的 `server_channel_open_forwarded_tcpip` 回调,回调把该 channel 桥接到本地 `remote_host:remote_port`。需在 Client handler 加"远程转发目标"状态(`Arc<Mutex<HashMap<port, (host,port)>>>`)。**若 russh 0.61 的 forwarded-tcpip 回调 API 无法确证,只实现 SOCKS + tcpip_forward 请求并明确标注 TODO,不要瞎猜回调签名。**
3. **dispatch**:`start_tunnel` 加 `tunnel_type: Option<String>` 参数;`'remote'`→start_remote,`'dynamic'`→start_socks,默认→start_local。前端 `TerminalView` 的 start_tunnel invoke 传 `tunnelType: session.tunnel_type`;NewSessionModal 的 tunnel_type 选项加 `'dynamic'`(动态,仅需 local_port)。

## 边界
- SOCKS 仅支持 CONNECT(无 BIND/UDP);无认证(本地回环监听)。
- 复用 stop-Notify 生命周期模式;close_ssh 清理 socks + remote forwards。
- 远程转发是最高风险/不可验证项——保守实现,清楚标注。
- 不动终端 I/O。

## 测试
`cargo check` 必过。运行时(用户):本地 SOCKS 端口可作 SSH 隧道代理;remote 转发服务端端口回连本地。
