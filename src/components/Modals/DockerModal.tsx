import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { SessionConfig } from '../../types';
import type { TranslationKeys } from '../../i18n';

const colorLabels = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981',
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#9ca3af', '#374151',
];

const dockerTabKeys: { id: string; labelKey: TranslationKeys }[] = [
  { id: 'standard', labelKey: 'docker_tab_standard' },
  { id: 'proxy', labelKey: 'docker_tab_proxy' },
];

export const DockerModal: React.FC = () => {
  const { showDockerModal, setShowDockerModal, addSession, sessions, t } = useAppStore();

  const [activeTab, setActiveTab] = useState('standard');
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
      setActiveTab('standard');
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
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="ssh-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ssh-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2>{t('docker_config_title')}</h2>
            <span className="docker-notice-badge">{t('docker_notice')}</span>
          </div>
          <button className="modal-close" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        {/* Tabs — centered pill style */}
        <div className="ssh-modal-tabs" style={{ justifyContent: 'center' }}>
          {dockerTabKeys.map((tab) => (
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
          {activeTab === 'standard' && (
            <>
              {/* Color label + Environment */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>{t('ssh_color_label')}</label>
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
                  <label>{t('ssh_environment')}</label>
                  <select
                    value={form.environment}
                    onChange={(e) => setForm({ ...form, environment: e.target.value })}
                  >
                    <option value="">{t('ssh_env_none')}</option>
                    <option value="dev">{t('ssh_env_dev')}</option>
                    <option value="staging">{t('ssh_env_staging')}</option>
                    <option value="production">{t('ssh_env_production')}</option>
                  </select>
                </div>
              </div>

              {/* Name + Protocol */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label className={nameError ? 'label-error' : ''}>{t('ssh_name')}</label>
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
                  <label>{t('docker_protocol')}</label>
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
                  <label>{t('docker_unix_path')}</label>
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
                  <label>{t('docker_connect_method')}</label>
                  <select
                    value={form.docker_connect_method}
                    onChange={(e) => setForm({ ...form, docker_connect_method: e.target.value })}
                  >
                    <option value="SSH">SSH</option>
                    <option value="Local">{t('common_local')}</option>
                  </select>
                </div>
                <div className="ssh-form-group">
                  <label>{t('docker_ssh_tunnel')}</label>
                  <select
                    value={form.docker_ssh_tunnel}
                    onChange={(e) => setForm({ ...form, docker_ssh_tunnel: e.target.value })}
                  >
                    <option value="">{t('docker_select')}</option>
                    {sshSessions.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Remark */}
              <div className="ssh-form-group">
                <label>{t('ssh_remark')}</label>
                <textarea
                  className="ssh-remark"
                  rows={3}
                  value={form.remark}
                  onChange={(e) => setForm({ ...form, remark: e.target.value })}
                />
              </div>
            </>
          )}

          {activeTab === 'proxy' && (
            <div className="ssh-tab-placeholder">
              <p>{t('docker_proxy_dev')}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="ssh-modal-footer">
          <button className="ssh-footer-link" style={{ fontSize: 12 }}>{t('docker_auto_config')}</button>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="ssh-footer-link" onClick={handleTest}>{t('docker_test')}</button>
            <button className="ssh-footer-link" onClick={handleSave}>{t('ssh_save')}</button>
          </div>
        </div>
      </div>
    </div>
  );
};
