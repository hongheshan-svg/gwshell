import React, { useState } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { SessionConfig } from '../../types';

const colorLabels = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981',
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#9ca3af', '#374151',
];

const configTabs = ['标准', '隧道', '代理', '环境变量', '高级'];

type AuthType = 'password' | 'publickey' | 'keyboardinteractive';

const authButtons: { id: AuthType | string; label: string }[] = [
  { id: 'password', label: '密码' },
  { id: 'publickey', label: '私钥' },
  { id: 'keyboardinteractive', label: 'MFA/2FA' },
];

const authExtras = [
  { id: 'preset-password', label: '预设账号密码' },
  { id: 'jump-key', label: '跳板机私钥' },
];

const authMore = [
  { id: 'ssh-agent', label: 'SSH Agent' },
  { id: 'no-auth', label: '不验证' },
];

export const NewSessionModal: React.FC = () => {
  const { showNewSession, setShowNewSession, addSession, addTab, editingSession, setEditingSession } = useAppStore();

  const [activeTab, setActiveTab] = useState('标准');
  const [showPassword, setShowPassword] = useState(false);
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
      });
      setTouched({});
      setActiveTab('标准');
      setShowPassword(false);
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

  const handleSave = () => {
    setTouched({ name: true, host: true });
    if (!form.name || !form.host) return;

    const sessionId = editingSession?.id || crypto.randomUUID();
    const now = new Date().toISOString().slice(0, 10);
    const config: SessionConfig = {
      id: sessionId,
      name: form.name,
      session_type: form.session_type || 'ssh',
      group: form.group || undefined,
      host: form.host || undefined,
      port: form.port || 22,
      username: form.username || undefined,
      auth_method: form.auth_method || 'password',
      password: form.password || undefined,
      private_key_path: form.private_key_path || undefined,
      remark: form.remark || undefined,
      color_label: form.color_label || undefined,
      environment: form.environment || undefined,
      created_at: editingSession?.created_at || now,
    };

    addSession(config);
    handleClose();
  };

  const handleTestConnect = async () => {
    setTouched({ name: true, host: true });
    if (!form.name || !form.host) return;

    const sessionId = editingSession?.id || crypto.randomUUID();
    const name = form.name || form.host || 'Local Shell';
    const sessionType = form.session_type || 'ssh';
    const now = new Date().toISOString().slice(0, 10);

    const config: SessionConfig = {
      id: sessionId,
      name,
      session_type: sessionType,
      group: form.group || undefined,
      host: form.host || undefined,
      port: form.port || 22,
      username: form.username || undefined,
      auth_method: form.auth_method || 'password',
      password: form.password || undefined,
      private_key_path: form.private_key_path || undefined,
      remark: form.remark || undefined,
      color_label: form.color_label || undefined,
      environment: form.environment || undefined,
      created_at: editingSession?.created_at || now,
    };

    addSession(config);

    const tabId = crypto.randomUUID();
    addTab({
      id: tabId,
      sessionId,
      title: name,
      type: sessionType,
      connected: false,
    });

    // Connection is initiated by TerminalView on mount
    handleClose();
  };

  const nameError = touched.name && !form.name;
  const hostError = touched.host && !form.host;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="ssh-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ssh-modal-header">
          <h2>SSH配置编辑</h2>
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
                <div className="ssh-auth-row">
                  {authButtons.map((btn) => (
                    <button
                      key={btn.id}
                      className={`ssh-auth-btn ${form.auth_method === btn.id ? 'active' : ''}`}
                      onClick={() => setForm({ ...form, auth_method: btn.id as AuthType })}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
                <div className="ssh-auth-row" style={{ marginTop: 6 }}>
                  {authExtras.map((btn) => (
                    <button key={btn.id} className="ssh-auth-btn">
                      {btn.label}
                    </button>
                  ))}
                </div>
                <div className="ssh-auth-row" style={{ marginTop: 6 }}>
                  {authMore.map((btn) => (
                    <button key={btn.id} className="ssh-auth-btn">
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Password with eye toggle */}
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

              {/* Private key path */}
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

          {activeTab !== '标准' && (
            <div className="ssh-tab-placeholder">
              <p>{activeTab} 配置（开发中）</p>
            </div>
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
