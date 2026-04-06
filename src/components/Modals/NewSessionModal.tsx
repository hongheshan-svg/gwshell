import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { SessionConfig } from '../../types';

export const NewSessionModal: React.FC = () => {
  const { showNewSession, setShowNewSession, addSession, addTab, editingSession, setEditingSession } = useAppStore();

  const [form, setForm] = useState<Partial<SessionConfig>>({
    name: '',
    session_type: 'ssh',
    host: '',
    port: 22,
    username: '',
    auth_method: 'password',
    password: '',
    private_key_path: '',
    group: '',
  });

  React.useEffect(() => {
    if (editingSession) {
      setForm(editingSession);
    } else {
      setForm({
        name: '',
        session_type: 'ssh',
        host: '',
        port: 22,
        username: '',
        auth_method: 'password',
        password: '',
        private_key_path: '',
        group: '',
      });
    }
  }, [editingSession, showNewSession]);

  if (!showNewSession) return null;

  const handleClose = () => {
    setShowNewSession(false);
    setEditingSession(null);
  };

  const handleSave = () => {
    const sessionId = editingSession?.id || crypto.randomUUID();
    const config: SessionConfig = {
      id: sessionId,
      name: form.name || `${form.host || 'Local Shell'}`,
      session_type: form.session_type || 'ssh',
      group: form.group || undefined,
      host: form.host || undefined,
      port: form.port || 22,
      username: form.username || undefined,
      auth_method: form.auth_method || 'password',
      password: form.password || undefined,
      private_key_path: form.private_key_path || undefined,
    };

    addSession(config);
    handleClose();
  };

  const handleConnect = async () => {
    const sessionId = editingSession?.id || crypto.randomUUID();
    const name = form.name || form.host || 'Local Shell';
    const sessionType = form.session_type || 'ssh';

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

    // For SSH connections, initiate from here
    if (sessionType === 'ssh' && form.host && form.username) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('ssh_connect', {
          sessionId,
          host: form.host,
          port: form.port || 22,
          username: form.username,
          password: form.password || null,
          privateKeyPath: form.private_key_path || null,
          rows: 24,
          cols: 80,
        });
      } catch (err) {
        console.error('SSH connect error:', err);
      }
    }

    handleClose();
  };

  const isLocalShell = form.session_type === 'localshell';

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{editingSession ? '编辑会话' : '新建会话'}</h2>
          <button className="modal-close" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* Session Type */}
          <div className="form-group">
            <label>连接类型</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['ssh', 'sftp', 'localshell'] as const).map((type) => (
                <button
                  key={type}
                  className={`btn ${form.session_type === type ? 'btn-primary' : ''}`}
                  style={{ flex: 1, textTransform: 'uppercase', fontSize: 11 }}
                  onClick={() => setForm({ ...form, session_type: type })}
                >
                  {type === 'localshell' ? 'Shell' : type}
                </button>
              ))}
            </div>
          </div>

          {/* Name + Group */}
          <div className="form-row">
            <div className="form-group">
              <label>名称</label>
              <input
                type="text"
                placeholder="My Server"
                value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>分组</label>
              <input
                type="text"
                placeholder="默认分组"
                value={form.group || ''}
                onChange={(e) => setForm({ ...form, group: e.target.value })}
              />
            </div>
          </div>

          {!isLocalShell && (
            <>
              {/* Host + Port */}
              <div className="form-row">
                <div className="form-group" style={{ flex: 3 }}>
                  <label>主机地址</label>
                  <input
                    type="text"
                    placeholder="192.168.1.1 或 example.com"
                    value={form.host || ''}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>端口</label>
                  <input
                    type="number"
                    value={form.port || 22}
                    onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 22 })}
                  />
                </div>
              </div>

              {/* Username */}
              <div className="form-group">
                <label>用户名</label>
                <input
                  type="text"
                  placeholder="root"
                  value={form.username || ''}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>

              {/* Auth Method */}
              <div className="form-group">
                <label>认证方式</label>
                <select
                  value={form.auth_method || 'password'}
                  onChange={(e) => setForm({ ...form, auth_method: e.target.value as any })}
                >
                  <option value="password">密码</option>
                  <option value="publickey">密钥</option>
                  <option value="keyboardinteractive">交互式</option>
                </select>
              </div>

              {/* Password / Key */}
              {form.auth_method === 'password' && (
                <div className="form-group">
                  <label>密码</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={form.password || ''}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                </div>
              )}

              {form.auth_method === 'publickey' && (
                <div className="form-group">
                  <label>私钥路径</label>
                  <input
                    type="text"
                    placeholder="~/.ssh/id_rsa"
                    value={form.private_key_path || ''}
                    onChange={(e) => setForm({ ...form, private_key_path: e.target.value })}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={handleClose}>取消</button>
          <button className="btn" onClick={handleSave}>保存</button>
          <button className="btn btn-primary" onClick={handleConnect}>
            {isLocalShell ? '打开' : '连接'}
          </button>
        </div>
      </div>
    </div>
  );
};
