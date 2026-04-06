import React, { useState } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { SessionConfig } from '../../types';

const colorLabels = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981',
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#9ca3af', '#374151',
];

const configTabs = ['标准', '隧道', '代理', '环境变量', '高级'];

type AuthType = 'password' | 'publickey' | 'keyboardinteractive' | 'agent' | 'none';

const authPrimary: { id: AuthType; label: string }[] = [
  { id: 'password', label: '密码' },
  { id: 'publickey', label: '私钥' },
  { id: 'keyboardinteractive', label: 'MFA/2FA' },
];

const authSecondary: { id: AuthType; label: string }[] = [
  { id: 'agent', label: 'SSH Agent' },
  { id: 'none', label: '不验证' },
];

export const NewSessionModal: React.FC = () => {
  const { showNewSession, setShowNewSession, addSession, addTab, editingSession, setEditingSession } = useAppStore();

  const [activeTab, setActiveTab] = useState('标准');
  const [showPassword, setShowPassword] = useState(false);
  const [showJumpPassword, setShowJumpPassword] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<Partial<SessionConfig>>({
    name: '',
    session_type: 'ssh',
    host: '',
    port: 22,
    username: 'root',
    auth_method: 'password',
    password: '',
    private_key_path: '',
    group: '',
    remark: '',
    color_label: '',
    environment: '',
    proxy_type: 'none',
    tunnel_type: 'local',
  });

  React.useEffect(() => {
    if (editingSession) {
      setForm(editingSession);
      setTouched({});
    } else {
      setForm({
        name: '',
        session_type: 'ssh',
        host: '',
        port: 22,
        username: 'root',
        auth_method: 'password',
        password: '',
        private_key_path: '',
        group: '',
        remark: '',
        color_label: '',
        environment: '',
        proxy_type: 'none',
        tunnel_type: 'local',
      });
      setTouched({});
      setActiveTab('标准');
      setShowPassword(false);
      setShowJumpPassword(false);
    }
  }, [editingSession, showNewSession]);

  if (!showNewSession) return null;

  const handleClose = () => {
    setShowNewSession(false);
    setEditingSession(null);
  };

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const buildConfig = (sessionId: string): SessionConfig => {
    const now = new Date().toISOString().slice(0, 10);
    return {
      id: sessionId,
      name: form.name!,
      session_type: form.session_type || 'ssh',
      group: form.group || undefined,
      host: form.host || undefined,
      port: form.port || 22,
      username: form.username || undefined,
      auth_method: form.auth_method || 'password',
      password: form.password || undefined,
      private_key_path: form.private_key_path || undefined,
      totp_code: form.totp_code || undefined,
      remark: form.remark || undefined,
      color_label: form.color_label || undefined,
      environment: form.environment || undefined,
      // Jump host
      jump_host: form.jump_host || undefined,
      jump_port: form.jump_port || undefined,
      jump_username: form.jump_username || undefined,
      jump_password: form.jump_password || undefined,
      jump_private_key_path: form.jump_private_key_path || undefined,
      // Proxy
      proxy_type: (form.proxy_type && form.proxy_type !== 'none') ? form.proxy_type : undefined,
      proxy_host: form.proxy_host || undefined,
      proxy_port: form.proxy_port || undefined,
      proxy_username: form.proxy_username || undefined,
      proxy_password: form.proxy_password || undefined,
      // Tunnel
      tunnel_enabled: form.tunnel_enabled || undefined,
      tunnel_type: form.tunnel_type || 'local',
      tunnel_local_port: form.tunnel_local_port || undefined,
      tunnel_remote_host: form.tunnel_remote_host || undefined,
      tunnel_remote_port: form.tunnel_remote_port || undefined,
      // Advanced
      keepalive_interval: form.keepalive_interval || undefined,
      connection_timeout: form.connection_timeout || undefined,
      server_alive_count_max: form.server_alive_count_max || undefined,
      compression: form.compression || undefined,
      // Env vars
      env_vars: form.env_vars || undefined,
      created_at: editingSession?.created_at || now,
    };
  };

  const handleSave = () => {
    setTouched({ name: true, host: true });
    if (!form.name || !form.host) return;
    const sessionId = editingSession?.id || crypto.randomUUID();
    addSession(buildConfig(sessionId));
    handleClose();
  };

  const handleTestConnect = async () => {
    setTouched({ name: true, host: true });
    if (!form.name || !form.host) return;

    const sessionId = editingSession?.id || crypto.randomUUID();
    const config = buildConfig(sessionId);
    addSession(config);

    const tabId = crypto.randomUUID();
    addTab({
      id: tabId,
      sessionId,
      title: config.name,
      type: config.session_type,
      connected: false,
    });
    handleClose();
  };

  const nameError = touched.name && !form.name;
  const hostError = touched.host && !form.host;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="ssh-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ssh-modal-header">
          <h2>SSH 配置编辑</h2>
          <button className="modal-close" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        {/* Config Tabs */}
        <div className="ssh-modal-tabs">
          {configTabs.map((tab) => (
            <button
              key={tab}
              className={`ssh-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="ssh-modal-body">

          {/* ══════════════ 标准 Tab ══════════════ */}
          {activeTab === '标准' && (
            <>
              {/* Color label + Environment */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>颜色标签</label>
                  <div className="color-label-row">
                    {colorLabels.map((color) => (
                      <button
                        key={color}
                        className={`color-dot ${form.color_label === color ? 'selected' : ''}`}
                        style={{ background: color }}
                        onClick={() => setForm({ ...form, color_label: color })}
                      />
                    ))}
                    <button
                      className="color-dot-clear"
                      onClick={() => setForm({ ...form, color_label: '' })}
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
                <div className="ssh-form-group">
                  <label>环境</label>
                  <select
                    value={form.environment || ''}
                    onChange={(e) => setForm({ ...form, environment: e.target.value })}
                  >
                    <option value="">无</option>
                    <option value="dev">开发</option>
                    <option value="staging">测试</option>
                    <option value="production">生产</option>
                  </select>
                </div>
              </div>

              {/* Name + Host */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label className={nameError ? 'label-error' : ''}>名称</label>
                  <input
                    type="text"
                    value={form.name || ''}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    onBlur={() => handleBlur('name')}
                    className={nameError ? 'input-error' : ''}
                  />
                  {nameError && <span className="field-error">name is a required field</span>}
                </div>
                <div className="ssh-form-group">
                  <label className={hostError ? 'label-error' : ''}>Host</label>
                  <input
                    type="text"
                    value={form.host || ''}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    onBlur={() => handleBlur('host')}
                    className={hostError ? 'input-error' : ''}
                  />
                  {hostError && <span className="field-error">host is a required field</span>}
                </div>
              </div>

              {/* User + Port */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>User</label>
                  <input
                    type="text"
                    value={form.username || ''}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                  />
                </div>
                <div className="ssh-form-group">
                  <label>端口</label>
                  <input
                    type="number"
                    value={form.port || 22}
                    onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 22 })}
                  />
                </div>
              </div>

              {/* Auth method toggle buttons */}
              <div className="ssh-form-group">
                <label>认证方式</label>
                <div className="ssh-auth-row">
                  {authPrimary.map((btn) => (
                    <button
                      key={btn.id}
                      className={`ssh-auth-btn ${form.auth_method === btn.id ? 'active' : ''}`}
                      onClick={() => setForm({ ...form, auth_method: btn.id })}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
                <div className="ssh-auth-row" style={{ marginTop: 6 }}>
                  {authSecondary.map((btn) => (
                    <button
                      key={btn.id}
                      className={`ssh-auth-btn ${form.auth_method === btn.id ? 'active' : ''}`}
                      onClick={() => setForm({ ...form, auth_method: btn.id })}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Password */}
              {form.auth_method === 'password' && (
                <div className="ssh-form-group">
                  <label>密码</label>
                  <div className="ssh-password-wrap">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password || ''}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                    />
                    <button
                      className="ssh-password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      type="button"
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              )}

              {/* Private key */}
              {form.auth_method === 'publickey' && (
                <div className="ssh-form-group">
                  <label>私钥路径</label>
                  <input
                    type="text"
                    placeholder="~/.ssh/id_rsa"
                    value={form.private_key_path || ''}
                    onChange={(e) => setForm({ ...form, private_key_path: e.target.value })}
                  />
                </div>
              )}

              {/* MFA/2FA */}
              {form.auth_method === 'keyboardinteractive' && (
                <>
                  <div className="ssh-form-group">
                    <label>密码（第一个提示）</label>
                    <div className="ssh-password-wrap">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="登录密码"
                        value={form.password || ''}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                      />
                      <button
                        className="ssh-password-toggle"
                        onClick={() => setShowPassword(!showPassword)}
                        type="button"
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <div className="ssh-form-group">
                    <label>验证码 / TOTP（第二个提示）</label>
                    <input
                      type="text"
                      placeholder="6 位动态码（可选，连接时也可留空后在终端输入）"
                      value={form.totp_code || ''}
                      onChange={(e) => setForm({ ...form, totp_code: e.target.value })}
                    />
                  </div>
                  <div className="ssh-tab-desc">
                    Keyboard-interactive：密码作为第一个 prompt 的回答，验证码作为第二个。
                    多轮 challenge 时后续均使用验证码字段。
                  </div>
                </>
              )}

              {/* SSH Agent info */}
              {form.auth_method === 'agent' && (
                <div className="ssh-tab-desc">
                  使用系统 SSH Agent（openssh-agent / Pageant）中已加载的密钥进行认证。
                  确保 SSH_AUTH_SOCK（Unix）或 OpenSSH Agent 服务（Windows）已运行。
                </div>
              )}

              {/* No-auth info */}
              {form.auth_method === 'none' && (
                <div className="ssh-tab-desc">
                  不进行认证（适用于允许免密登录的特殊服务器）。
                </div>
              )}

              {/* Remark */}
              <div className="ssh-form-group">
                <label>备注</label>
                <textarea
                  className="ssh-remark"
                  rows={3}
                  value={form.remark || ''}
                  onChange={(e) => setForm({ ...form, remark: e.target.value })}
                />
              </div>
            </>
          )}

          {/* ══════════════ 隧道 Tab ══════════════ */}
          {activeTab === '隧道' && (
            <>
              <div className="ssh-form-group">
                <label>本地端口转发</label>
                <label className="ssh-toggle-label">
                  <input
                    type="checkbox"
                    checked={form.tunnel_enabled || false}
                    onChange={(e) => setForm({ ...form, tunnel_enabled: e.target.checked })}
                  />
                  <span>连接时自动建立隧道</span>
                </label>
              </div>

              {form.tunnel_enabled && (
                <>
                  <div className="ssh-form-group">
                    <label>转发类型</label>
                    <select
                      value={form.tunnel_type || 'local'}
                      onChange={(e) => setForm({ ...form, tunnel_type: e.target.value as 'local' | 'remote' })}
                    >
                      <option value="local">本地转发 Local (-L)：本地端口 → 远端目标</option>
                      <option value="remote">远程转发 Remote (-R)：远端端口 → 本地目标（暂不支持）</option>
                    </select>
                  </div>

                  <div className="ssh-form-row">
                    <div className="ssh-form-group">
                      <label>本地监听端口</label>
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        placeholder="例：13306"
                        value={form.tunnel_local_port || ''}
                        onChange={(e) => setForm({ ...form, tunnel_local_port: parseInt(e.target.value) || undefined })}
                      />
                    </div>
                    <div className="ssh-form-group" />
                  </div>

                  <div className="ssh-form-row">
                    <div className="ssh-form-group">
                      <label>远端目标主机</label>
                      <input
                        type="text"
                        placeholder="localhost"
                        value={form.tunnel_remote_host || ''}
                        onChange={(e) => setForm({ ...form, tunnel_remote_host: e.target.value })}
                      />
                    </div>
                    <div className="ssh-form-group">
                      <label>远端目标端口</label>
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        placeholder="例：3306"
                        value={form.tunnel_remote_port || ''}
                        onChange={(e) => setForm({ ...form, tunnel_remote_port: parseInt(e.target.value) || undefined })}
                      />
                    </div>
                  </div>

                  {form.tunnel_local_port && form.tunnel_remote_host && form.tunnel_remote_port && (
                    <div className="ssh-tab-desc">
                      连接成功后，访问 <code>127.0.0.1:{form.tunnel_local_port}</code> 将通过
                      SSH 隧道转发至远端的 <code>{form.tunnel_remote_host}:{form.tunnel_remote_port}</code>。
                    </div>
                  )}
                </>
              )}

              {!form.tunnel_enabled && (
                <div className="ssh-tab-placeholder">
                  <p>启用隧道后配置本地端口转发规则</p>
                </div>
              )}
            </>
          )}

          {/* ══════════════ 代理 Tab ══════════════ */}
          {activeTab === '代理' && (
            <>
              <div className="ssh-form-group">
                <label>代理类型</label>
                <select
                  value={form.proxy_type || 'none'}
                  onChange={(e) => setForm({ ...form, proxy_type: e.target.value as SessionConfig['proxy_type'] })}
                >
                  <option value="none">不使用代理</option>
                  <option value="socks5">SOCKS5</option>
                  <option value="http">HTTP CONNECT</option>
                </select>
              </div>

              {form.proxy_type && form.proxy_type !== 'none' && (
                <>
                  <div className="ssh-form-row">
                    <div className="ssh-form-group">
                      <label>代理服务器地址</label>
                      <input
                        type="text"
                        placeholder="127.0.0.1"
                        value={form.proxy_host || ''}
                        onChange={(e) => setForm({ ...form, proxy_host: e.target.value })}
                      />
                    </div>
                    <div className="ssh-form-group">
                      <label>代理端口</label>
                      <input
                        type="number"
                        placeholder={form.proxy_type === 'socks5' ? '1080' : '8080'}
                        value={form.proxy_port || ''}
                        onChange={(e) => setForm({ ...form, proxy_port: parseInt(e.target.value) || undefined })}
                      />
                    </div>
                  </div>

                  <div className="ssh-form-row">
                    <div className="ssh-form-group">
                      <label>代理用户名（可选）</label>
                      <input
                        type="text"
                        value={form.proxy_username || ''}
                        onChange={(e) => setForm({ ...form, proxy_username: e.target.value })}
                      />
                    </div>
                    <div className="ssh-form-group">
                      <label>代理密码（可选）</label>
                      <input
                        type="password"
                        value={form.proxy_password || ''}
                        onChange={(e) => setForm({ ...form, proxy_password: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="ssh-tab-desc">
                    SSH 连接将通过 {form.proxy_type === 'socks5' ? 'SOCKS5' : 'HTTP CONNECT'} 代理
                    {form.proxy_host ? ` ${form.proxy_host}:${form.proxy_port || (form.proxy_type === 'socks5' ? 1080 : 8080)}` : ''} 建立。
                  </div>
                </>
              )}

              {(!form.proxy_type || form.proxy_type === 'none') && (
                <div className="ssh-tab-placeholder">
                  <p>选择代理类型后进行配置</p>
                </div>
              )}
            </>
          )}

          {/* ══════════════ 环境变量 Tab ══════════════ */}
          {activeTab === '环境变量' && (
            <>
              <div className="ssh-form-group">
                <label>自定义环境变量</label>
                <textarea
                  className="ssh-remark"
                  rows={10}
                  placeholder={'KEY=VALUE\nPATH=/custom/path\nLANG=en_US.UTF-8'}
                  value={form.env_vars || ''}
                  onChange={(e) => setForm({ ...form, env_vars: e.target.value })}
                />
              </div>
              <div className="ssh-tab-desc">
                每行一个，格式为 <code>KEY=VALUE</code>。
                仅在服务器 sshd_config 中 <code>AcceptEnv</code> 允许的变量才会生效。
              </div>
            </>
          )}

          {/* ══════════════ 高级 Tab ══════════════ */}
          {activeTab === '高级' && (
            <>
              {/* Connection settings */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>连接超时（秒）</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="30"
                    value={form.connection_timeout || ''}
                    onChange={(e) => setForm({ ...form, connection_timeout: parseInt(e.target.value) || undefined })}
                  />
                </div>
                <div className="ssh-form-group">
                  <label>Keepalive 间隔（秒）</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="60"
                    value={form.keepalive_interval || ''}
                    onChange={(e) => setForm({ ...form, keepalive_interval: parseInt(e.target.value) || undefined })}
                  />
                </div>
              </div>

              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>ServerAliveCountMax</label>
                  <input
                    type="number"
                    min={1}
                    placeholder="3"
                    value={form.server_alive_count_max || ''}
                    onChange={(e) => setForm({ ...form, server_alive_count_max: parseInt(e.target.value) || undefined })}
                  />
                </div>
                <div className="ssh-form-group">
                  <label style={{ visibility: 'hidden' }}>占位</label>
                  <label className="ssh-toggle-label">
                    <input
                      type="checkbox"
                      checked={form.compression || false}
                      onChange={(e) => setForm({ ...form, compression: e.target.checked })}
                    />
                    <span>启用数据压缩</span>
                  </label>
                </div>
              </div>

              {/* Jump host section */}
              <div className="ssh-section-divider">
                <span>跳板机（Jump Host / -J）</span>
              </div>

              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>跳板机地址</label>
                  <input
                    type="text"
                    placeholder="jump.example.com"
                    value={form.jump_host || ''}
                    onChange={(e) => setForm({ ...form, jump_host: e.target.value })}
                  />
                </div>
                <div className="ssh-form-group">
                  <label>端口</label>
                  <input
                    type="number"
                    placeholder="22"
                    value={form.jump_port || ''}
                    onChange={(e) => setForm({ ...form, jump_port: parseInt(e.target.value) || undefined })}
                  />
                </div>
              </div>

              {form.jump_host && (
                <>
                  <div className="ssh-form-row">
                    <div className="ssh-form-group">
                      <label>跳板机用户名</label>
                      <input
                        type="text"
                        placeholder="root"
                        value={form.jump_username || ''}
                        onChange={(e) => setForm({ ...form, jump_username: e.target.value })}
                      />
                    </div>
                    <div className="ssh-form-group">
                      <label>跳板机密码</label>
                      <div className="ssh-password-wrap">
                        <input
                          type={showJumpPassword ? 'text' : 'password'}
                          value={form.jump_password || ''}
                          onChange={(e) => setForm({ ...form, jump_password: e.target.value })}
                        />
                        <button
                          className="ssh-password-toggle"
                          onClick={() => setShowJumpPassword(!showJumpPassword)}
                          type="button"
                        >
                          {showJumpPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="ssh-form-group">
                    <label>跳板机私钥路径（可选，优先于密码）</label>
                    <input
                      type="text"
                      placeholder="~/.ssh/id_rsa"
                      value={form.jump_private_key_path || ''}
                      onChange={(e) => setForm({ ...form, jump_private_key_path: e.target.value })}
                    />
                  </div>
                  <div className="ssh-tab-desc">
                    连接流程：本机 → 跳板机 ({form.jump_host}:{form.jump_port || 22}) →
                    目标主机 ({form.host || '目标'}:{form.port || 22})
                  </div>
                </>
              )}
            </>
          )}

        </div>

        {/* Footer */}
        <div className="ssh-modal-footer">
          <button className="ssh-footer-link" onClick={handleTestConnect}>测试连接</button>
          <button className="ssh-footer-link" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
};
