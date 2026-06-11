import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useEscapeClose } from '../../lib/useEscapeClose';
import type { SessionConfig } from '../../types';

const colorLabels = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981',
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#9ca3af', '#374151',
];

export const DockerModal: React.FC = () => {
  const { showDockerModal, setShowDockerModal, addSession, sessions } = useAppStore();
  const { t } = useTranslation();

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [testState, setTestState] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'err'; text?: string }>({ kind: 'idle' });
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
      setTestState({ kind: 'idle' });
    }
  }, [showDockerModal]);

  if (!showDockerModal) return null;

  const handleClose = () => setShowDockerModal(false);
  useEscapeClose(handleClose);

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

  // Probe the configured Docker host with a one-shot `docker ps` (the same
  // backend command the container picker uses) without saving the session.
  const handleTest = async () => {
    if (form.docker_connect_method === 'SSH' && !form.docker_ssh_tunnel) {
      setTestState({ kind: 'err', text: t('docker_test_need_tunnel') });
      return;
    }
    setTestState({ kind: 'busy' });
    try {
      const containers = await invoke<unknown[]>('docker_list_containers', {
        connectMethod: form.docker_connect_method,
        tunnelSessionId: form.docker_ssh_tunnel || null,
      });
      setTestState({ kind: 'ok', text: t('docker_test_ok', { count: containers.length }) });
    } catch (e) {
      setTestState({ kind: 'err', text: String(e) });
    }
  };

  const nameError = touched.name && !form.name;

  // Get SSH sessions for tunnel dropdown
  const sshSessions = sessions.filter((s) => s.session_type === 'ssh');

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="ssh-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ssh-modal-header">
          <h2>{t('docker_config_title')}</h2>
          <button className="modal-close" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="ssh-modal-body">
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
        </div>

        {/* Footer */}
        <div className="ssh-modal-footer">
          {testState.kind !== 'idle' && (
            <span
              className="settings-desc"
              style={{
                fontSize: 12,
                alignSelf: 'center',
                color: testState.kind === 'err' ? 'var(--danger)' : testState.kind === 'ok' ? 'var(--success)' : undefined,
              }}
            >
              {testState.kind === 'busy' ? t('docker_testing') : testState.text}
            </span>
          )}
          <div style={{ display: 'flex', gap: 12, marginLeft: 'auto' }}>
            <button
              className="ssh-footer-link"
              onClick={handleTest}
              disabled={testState.kind === 'busy'}
              title={t('docker_test')}
            >
              {t('docker_test')}
            </button>
            <button className="ssh-footer-link" onClick={handleSave}>{t('ssh_save')}</button>
          </div>
        </div>
      </div>
    </div>
  );
};
