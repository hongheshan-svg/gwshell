import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Eye, EyeOff } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { SessionConfig } from '../../types';
import type { TranslationKeys } from '../../i18n';

const configTabKeys: { id: string; labelKey: TranslationKeys }[] = [
  { id: 'standard', labelKey: 'ssh_tab_standard' },
  { id: 'tunnel', labelKey: 'ssh_tab_tunnel' },
  { id: 'proxy', labelKey: 'ssh_tab_proxy' },
  { id: 'env', labelKey: 'ssh_tab_env' },
  { id: 'advanced', labelKey: 'ssh_tab_advanced' },
];

type AuthType = 'password' | 'publickey' | 'keyboardinteractive' | 'agent' | 'none';

const authPrimary: { id: AuthType; labelKey: TranslationKeys }[] = [
  { id: 'password', labelKey: 'ssh_auth_password' },
  { id: 'publickey', labelKey: 'ssh_auth_publickey' },
  { id: 'keyboardinteractive', labelKey: 'ssh_auth_mfa' },
];

const authSecondary: { id: AuthType; labelKey: TranslationKeys }[] = [
  { id: 'agent', labelKey: 'ssh_auth_agent' },
  { id: 'none', labelKey: 'ssh_auth_none' },
];

export const NewSessionModal: React.FC = () => {
  const { showNewSession, setShowNewSession, addSession, addTab, editingSession, setEditingSession } = useAppStore();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState('standard');
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
      setActiveTab('standard');
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
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="ssh-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ssh-modal-header">
          <h2>{t('ssh_config_title')}</h2>
          <button className="modal-close" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        {/* Config Tabs */}
        <div className="ssh-modal-tabs">
          {configTabKeys.map((tab) => (
            <button
              key={tab.id}
              className={`ssh-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="ssh-modal-body">

          {/* ══════════════ 标准 Tab ══════════════ */}
          {activeTab === 'standard' && (
            <>
              {/* Color label + Environment */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>{t('ssh_color_label')}</label>
                  <select
                    value={form.environment || ''}
                    onChange={(e) => setForm({ ...form, environment: e.target.value })}
                  >
                    <option value="">{t('ssh_env_none')}</option>
                    <option value="dev">{t('ssh_env_dev')}</option>
                    <option value="staging">{t('ssh_env_staging')}</option>
                    <option value="production">{t('ssh_env_production')}</option>
                  </select>
                </div>
              </div>

              {/* Name + Host */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label className={nameError ? 'label-error' : ''}>{t('ssh_name')}</label>
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
                  <label>{t('ssh_port')}</label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port || 22}
                    onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 22 })}
                  />
                </div>
              </div>

              {/* Auth method */}
              <div className="ssh-form-group">
                <label>{t('ssh_auth_method')}</label>
                <div className="ssh-auth-row">
                  {authPrimary.map((btn) => (
                    <button
                      key={btn.id}
                      className={`ssh-auth-btn ${form.auth_method === btn.id ? 'active' : ''}`}
                      onClick={() => setForm({ ...form, auth_method: btn.id })}
                    >
                      {t(btn.labelKey)}
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
                      {t(btn.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Password */}
              {form.auth_method === 'password' && (
                <div className="ssh-form-group">
                  <label>{t('ssh_password')}</label>
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
                  <label>{t('ssh_private_key_path')}</label>
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
                    <label>{t('ssh_mfa_password_hint')}</label>
                    <div className="ssh-password-wrap">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder={t('ssh_mfa_password_placeholder')}
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
                    <label>{t('ssh_mfa_totp_label')}</label>
                    <input
                      type="text"
                      placeholder={t('ssh_mfa_totp_placeholder')}
                      value={form.totp_code || ''}
                      onChange={(e) => setForm({ ...form, totp_code: e.target.value })}
                    />
                  </div>
                  <div className="ssh-tab-desc">
                    {t('ssh_mfa_desc')}
                  </div>
                </>
              )}

              {/* SSH Agent info */}
              {form.auth_method === 'agent' && (
                <div className="ssh-tab-desc">
                  {t('ssh_agent_desc')}
                </div>
              )}

              {/* No-auth info */}
              {form.auth_method === 'none' && (
                <div className="ssh-tab-desc">
                  {t('ssh_noauth_desc')}
                </div>
              )}

              {/* Remark */}
              <div className="ssh-form-group">
                <label>{t('ssh_remark')}</label>
                <textarea
                  rows={2}
                  value={form.remark || ''}
                  onChange={(e) => setForm({ ...form, remark: e.target.value })}
                />
              </div>
            </>
          )}

          {/* ══════════════ 隧道 Tab ══════════════ */}
          {activeTab === 'tunnel' && (
            <>
              <div className="ssh-form-group">
                <label>{t('ssh_tunnel_label')}</label>
                <label className="ssh-toggle-label">
                  <input
                    type="checkbox"
                    checked={form.tunnel_enabled || false}
                    onChange={(e) => setForm({ ...form, tunnel_enabled: e.target.checked })}
                  />
                  <span>{t('ssh_tunnel_auto')}</span>
                </label>
              </div>

              {form.tunnel_enabled && (
                <>
                  <div className="ssh-form-group">
                    <label>{t('ssh_tunnel_type')}</label>
                    <select
                      value={form.tunnel_type || 'local'}
                      onChange={(e) => setForm({ ...form, tunnel_type: e.target.value as 'local' | 'remote' })}
                    >
                      <option value="local">{t('ssh_tunnel_local')}</option>
                      <option value="remote">{t('ssh_tunnel_remote')}</option>
                    </select>
                  </div>

                  <div className="ssh-form-row">
                    <div className="ssh-form-group">
                      <label>{t('ssh_tunnel_local_port')}</label>
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        placeholder="e.g. 13306"
                        value={form.tunnel_local_port || ''}
                        onChange={(e) => setForm({ ...form, tunnel_local_port: parseInt(e.target.value) || undefined })}
                      />
                    </div>
                    <div className="ssh-form-group" />
                  </div>

                  <div className="ssh-form-row">
                    <div className="ssh-form-group">
                      <label>{t('ssh_tunnel_remote_host')}</label>
                      <input
                        type="text"
                        placeholder="localhost"
                        value={form.tunnel_remote_host || ''}
                        onChange={(e) => setForm({ ...form, tunnel_remote_host: e.target.value })}
                      />
                    </div>
                    <div className="ssh-form-group">
                      <label>{t('ssh_tunnel_remote_port')}</label>
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        placeholder="e.g. 3306"
                        value={form.tunnel_remote_port || ''}
                        onChange={(e) => setForm({ ...form, tunnel_remote_port: parseInt(e.target.value) || undefined })}
                      />
                    </div>
                  </div>

                  {form.tunnel_local_port && form.tunnel_remote_host && form.tunnel_remote_port && (
                    <div className="ssh-tab-desc">
                      {t('ssh_tunnel_desc', { localPort: form.tunnel_local_port!, remoteHost: form.tunnel_remote_host!, remotePort: form.tunnel_remote_port! })}
                    </div>
                  )}
                </>
              )}

              {!form.tunnel_enabled && (
                <div className="ssh-tab-placeholder">
                  <p>{t('ssh_tunnel_enable_hint')}</p>
                </div>
              )}
            </>
          )}

          {/* ══════════════ 代理 Tab ══════════════ */}
          {activeTab === 'proxy' && (
            <>
              <div className="ssh-form-group">
                <label>{t('ssh_proxy_type')}</label>
                <select
                  value={form.proxy_type || 'none'}
                  onChange={(e) => setForm({ ...form, proxy_type: e.target.value as SessionConfig['proxy_type'] })}
                >
                  <option value="none">{t('ssh_proxy_none')}</option>
                  <option value="socks5">SOCKS5</option>
                  <option value="http">HTTP CONNECT</option>
                </select>
              </div>

              {form.proxy_type && form.proxy_type !== 'none' && (
                <>
                  <div className="ssh-form-row">
                    <div className="ssh-form-group">
                      <label>{t('ssh_proxy_server')}</label>
                      <input
                        type="text"
                        placeholder="127.0.0.1"
                        value={form.proxy_host || ''}
                        onChange={(e) => setForm({ ...form, proxy_host: e.target.value })}
                      />
                    </div>
                    <div className="ssh-form-group">
                      <label>{t('ssh_proxy_port')}</label>
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
                      <label>{t('ssh_proxy_username')}</label>
                      <input
                        type="text"
                        value={form.proxy_username || ''}
                        onChange={(e) => setForm({ ...form, proxy_username: e.target.value })}
                      />
                    </div>
                    <div className="ssh-form-group">
                      <label>{t('ssh_proxy_password')}</label>
                      <input
                        type="password"
                        value={form.proxy_password || ''}
                        onChange={(e) => setForm({ ...form, proxy_password: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="ssh-tab-desc">
                    {t('ssh_proxy_desc', { proxyType: form.proxy_type === 'socks5' ? 'SOCKS5' : 'HTTP CONNECT', proxyAddr: form.proxy_host ? ` ${form.proxy_host}:${form.proxy_port || (form.proxy_type === 'socks5' ? 1080 : 8080)}` : '' })}
                  </div>
                </>
              )}

              {(!form.proxy_type || form.proxy_type === 'none') && (
                <div className="ssh-tab-placeholder">
                  <p>{t('ssh_proxy_hint')}</p>
                </div>
              )}
            </>
          )}

          {/* ══════════════ 环境变量 Tab ══════════════ */}
          {activeTab === 'env' && (
            <>
              <div className="ssh-form-group">
                <label>{t('ssh_env_custom')}</label>
                <textarea
                  className="ssh-remark"
                  rows={10}
                  placeholder={'KEY=VALUE\nPATH=/custom/path\nLANG=en_US.UTF-8'}
                  value={form.env_vars || ''}
                  onChange={(e) => setForm({ ...form, env_vars: e.target.value })}
                />
              </div>
              <div className="ssh-tab-desc">
                {t('ssh_env_desc')}
              </div>
            </>
          )}

          {/* ══════════════ 高级 Tab ══════════════ */}
          {activeTab === 'advanced' && (
            <>
              {/* Connection settings */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>{t('ssh_conn_timeout')}</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="30"
                    value={form.connection_timeout || ''}
                    onChange={(e) => setForm({ ...form, connection_timeout: parseInt(e.target.value) || undefined })}
                  />
                </div>
                <div className="ssh-form-group">
                  <label>{t('ssh_keepalive')}</label>
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
                  <label style={{ visibility: 'hidden' }}>{t('common_placeholder')}</label>
                  <label className="ssh-toggle-label">
                    <input
                      type="checkbox"
                      checked={form.compression || false}
                      onChange={(e) => setForm({ ...form, compression: e.target.checked })}
                    />
                    <span>{t('ssh_compression')}</span>
                  </label>
                </div>
              </div>

              {/* Jump host section */}
              <div className="ssh-section-divider">
                <span>{t('ssh_jump_title')}</span>
              </div>

              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>{t('ssh_jump_host')}</label>
                  <input
                    type="text"
                    placeholder="jump.example.com"
                    value={form.jump_host || ''}
                    onChange={(e) => setForm({ ...form, jump_host: e.target.value })}
                  />
                </div>
                <div className="ssh-form-group">
                  <label>{t('ssh_jump_port')}</label>
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
                      <label>{t('ssh_jump_username')}</label>
                      <input
                        type="text"
                        placeholder="root"
                        value={form.jump_username || ''}
                        onChange={(e) => setForm({ ...form, jump_username: e.target.value })}
                      />
                    </div>
                    <div className="ssh-form-group">
                      <label>{t('ssh_jump_password')}</label>
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
                    <label>{t('ssh_jump_key_path')}</label>
                    <input
                      type="text"
                      placeholder="~/.ssh/id_rsa"
                      value={form.jump_private_key_path || ''}
                      onChange={(e) => setForm({ ...form, jump_private_key_path: e.target.value })}
                    />
                  </div>
                  <div className="ssh-tab-desc">
                    {t('ssh_jump_desc', { jumpHost: form.jump_host!, jumpPort: form.jump_port || 22, host: form.host || 'target', port: form.port || 22 })}
                  </div>
                </>
              )}
            </>
          )}

        </div>

        {/* Footer */}
        <div className="ssh-modal-footer">
          <button className="ssh-footer-link" onClick={handleTestConnect}>{t('ssh_test_connect')}</button>
          <button className="ssh-footer-link" onClick={handleSave}>{t('ssh_save')}</button>
        </div>
      </div>
    </div>
  );
};
