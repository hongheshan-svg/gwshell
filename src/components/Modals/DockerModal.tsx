import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { SessionConfig } from '../../types';

const colorLabels = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981',
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#9ca3af', '#374151',
];

const dockerTabs = ['标准', '代理'];

export const DockerModal: React.FC = () => {
  const { showDockerModal, setShowDockerModal, addSession, sessions } = useAppStore();

  const [activeTab, setActiveTab] = useState('标准');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({
    name: '',
    color_label: '',
    environment: '',
    docker_protocol: 'unix' as 'unix' | 'tcp' | 'http' | 'https',
    docker_unix_path: '/var/run/docker.sock',
    docker_connect_method: 'SSH',
    docker_ssh_tunnel: '',
    remark: '',
  });

  React.useEffect(() => {
    if (showDockerModal) {
      setForm({
        name: '',
        color_label: '',
        environment: '',
        docker_protocol: 'unix',
        docker_unix_path: '/var/run/docker.sock',
        docker_connect_method: 'SSH',
        docker_ssh_tunnel: '',
        remark: '',
      });
      setTouched({});
      setActiveTab('标准');
    }
  }, [showDockerModal]);

  if (!showDockerModal) return null;

  const handleClose = () => setShowDockerModal(false);

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleSave = () => {
    setTouched({ name: true });
    if (!form.name) return;

    const now = new Date().toISOString().slice(0, 10);
    const config: SessionConfig = {
      id: crypto.randomUUID(),
      name: form.name,
      session_type: 'docker',
      auth_method: 'password',
      color_label: form.color_label || undefined,
      environment: form.environment || undefined,
      docker_protocol: form.docker_protocol,
      docker_unix_path: form.docker_unix_path || undefined,
      docker_connect_method: form.docker_connect_method || undefined,
      docker_ssh_tunnel: form.docker_ssh_tunnel || undefined,
      remark: form.remark || undefined,
      created_at: now,
    };

    addSession(config);
    handleClose();
  };

  const handleTest = () => {
    setTouched({ name: true });
    if (!form.name) return;
    // TODO: actual docker test
    handleSave();
  };

  const nameError = touched.name && !form.name;

  // Get SSH sessions for tunnel dropdown
  const sshSessions = sessions.filter((s) => s.session_type === 'ssh');

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="ssh-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ssh-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2>Docker配置编辑</h2>
            <span className="docker-notice-badge">使用须知！！！</span>
          </div>
          <button className="modal-close" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        {/* Tabs — centered pill style */}
        <div className="ssh-modal-tabs" style={{ justifyContent: 'center' }}>
          {dockerTabs.map((tab) => (
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
                    value={form.environment}
                    onChange={(e) => setForm({ ...form, environment: e.target.value })}
                  >
                    <option value="">无</option>
                    <option value="dev">开发</option>
                    <option value="staging">测试</option>
                    <option value="production">生产</option>
                  </select>
                </div>
              </div>

              {/* Name + Protocol */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label className={nameError ? 'label-error' : ''}>名称</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    onBlur={() => handleBlur('name')}
                    className={nameError ? 'input-error' : ''}
                  />
                  {nameError && <span className="field-error">name is a required field</span>}
                </div>
                <div className="ssh-form-group">
                  <label>协议</label>
                  <select
                    value={form.docker_protocol}
                    onChange={(e) => setForm({ ...form, docker_protocol: e.target.value as any })}
                  >
                    <option value="unix">Unix</option>
                    <option value="tcp">TCP</option>
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                  </select>
                </div>
              </div>

              {/* Unix Path */}
              {form.docker_protocol === 'unix' && (
                <div className="ssh-form-group">
                  <label>Unix路径</label>
                  <input
                    type="text"
                    value={form.docker_unix_path}
                    onChange={(e) => setForm({ ...form, docker_unix_path: e.target.value })}
                  />
                </div>
              )}

              {/* Connect method + SSH Tunnel */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>连接方式</label>
                  <select
                    value={form.docker_connect_method}
                    onChange={(e) => setForm({ ...form, docker_connect_method: e.target.value })}
                  >
                    <option value="SSH">SSH</option>
                    <option value="Local">本地</option>
                  </select>
                </div>
                <div className="ssh-form-group">
                  <label>SSH隧道</label>
                  <select
                    value={form.docker_ssh_tunnel}
                    onChange={(e) => setForm({ ...form, docker_ssh_tunnel: e.target.value })}
                  >
                    <option value="">请选择</option>
                    {sshSessions.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Remark */}
              <div className="ssh-form-group">
                <label>备注</label>
                <textarea
                  className="ssh-remark"
                  rows={3}
                  value={form.remark}
                  onChange={(e) => setForm({ ...form, remark: e.target.value })}
                />
              </div>
            </>
          )}

          {activeTab === '代理' && (
            <div className="ssh-tab-placeholder">
              <p>代理配置（开发中）</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="ssh-modal-footer">
          <button className="ssh-footer-link" style={{ fontSize: 12 }}>连接失败？自动配置！！！</button>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="ssh-footer-link" onClick={handleTest}>测试</button>
            <button className="ssh-footer-link" onClick={handleSave}>保存</button>
          </div>
        </div>
      </div>
    </div>
  );
};
