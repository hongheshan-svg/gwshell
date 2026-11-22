import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useEscapeClose } from '../../lib/useEscapeClose';
import { GroupSelectField } from './GroupSelectField';
import { ColorLabelPicker } from './ColorLabelPicker';
import type { SessionConfig } from '../../types';

export const DockerModal: React.FC = () => {
  const showDockerModal = useAppStore((s) => s.showDockerModal);
  const setShowDockerModal = useAppStore((s) => s.setShowDockerModal);
  const editingSession = useAppStore((s) => s.editingSession);
  const setEditingSession = useAppStore((s) => s.setEditingSession);
  const addSession = useAppStore((s) => s.addSession);
  const sessions = useAppStore((s) => s.sessions);
  const { t } = useTranslation();

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [testState, setTestState] = useState<{
    kind: 'idle' | 'busy' | 'ok' | 'err';
    text?: string;
  }>({ kind: 'idle' });
  const [form, setForm] = useState({
    name: '',
    group: '',
    color_label: '',
    environment: '',
    docker_protocol: 'unix' as 'unix' | 'tcp' | 'http' | 'https', // eslint-disable-line no-restricted-syntax -- literal widening for union default value
    docker_unix_path: '/var/run/docker.sock',
    docker_connect_method: 'SSH',
    docker_ssh_tunnel: '',
    remark: '',
  });

  const isEditing = editingSession?.session_type === 'docker';

  React.useEffect(() => {
    if (showDockerModal) {
      if (editingSession?.session_type === 'docker') {
        setForm({
          name: editingSession.name,
          group: editingSession.group ?? '',
          color_label: editingSession.color_label ?? '',
          environment: editingSession.environment ?? '',
          docker_protocol: editingSession.docker_protocol ?? 'unix',
          docker_unix_path: editingSession.docker_unix_path ?? '/var/run/docker.sock',
          docker_connect_method: editingSession.docker_connect_method ?? 'SSH',
          docker_ssh_tunnel: editingSession.docker_ssh_tunnel ?? '',
          remark: editingSession.remark ?? '',
        });
      } else {
        setForm({
          name: '',
          group: '',
          color_label: '',
          environment: '',
          docker_protocol: 'unix',
          docker_unix_path: '/var/run/docker.sock',
          docker_connect_method: 'SSH',
          docker_ssh_tunnel: '',
          remark: '',
        });
      }
      setTouched({});
      setTestState({ kind: 'idle' });
    }
  }, [showDockerModal, editingSession]);

  // Hooks must run unconditionally (before any early return) per rules-of-hooks.
  const handleClose = () => {
    setShowDockerModal(false);
    setEditingSession(null);
  };
  useEscapeClose(handleClose);

  if (!showDockerModal) return null;

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleSave = () => {
    setTouched({ name: true });
    if (!form.name) return;

    const now = new Date().toISOString().slice(0, 10);
    const config: SessionConfig = {
      id: isEditing ? editingSession.id : crypto.randomUUID(),
      name: form.name,
      session_type: 'docker',
      auth_method: 'password',
      group: form.group.trim() || undefined,
      color_label: form.color_label || undefined,
      environment: form.environment || undefined,
      docker_protocol: form.docker_protocol,
      docker_unix_path: form.docker_unix_path || undefined,
      docker_connect_method: form.docker_connect_method || undefined,
      docker_ssh_tunnel:
        form.docker_connect_method === 'SSH' ? form.docker_ssh_tunnel || undefined : undefined,
      remark: form.remark || undefined,
      created_at: isEditing ? editingSession.created_at : now,
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
    const rawPath = form.docker_unix_path.trim();
    const dockerHost = rawPath
      ? rawPath.includes('://')
        ? rawPath
        : `${form.docker_protocol}://${rawPath}`
      : null;
    setTestState({ kind: 'busy' });
    try {
      const containers = await invoke<unknown[]>('docker_list_containers', {
        connectMethod: form.docker_connect_method,
        tunnelSessionId:
          form.docker_connect_method === 'SSH' ? form.docker_ssh_tunnel || null : null,
        dockerHost,
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
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
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
              <ColorLabelPicker
                value={form.color_label}
                onChange={(color_label) => setForm({ ...form, color_label })}
              />
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
                {nameError && <span className="field-error">{t('field_required')}</span>}
              </div>
              <div className="ssh-form-group">
                <label>{t('docker_protocol')}</label>
                <select
                  value={form.docker_protocol}
                  onChange={(e) => {
                    // eslint-disable-next-line no-restricted-syntax
                    const nextProto = e.target.value as 'unix' | 'tcp' | 'http' | 'https';
                    setForm({
                      ...form,
                      docker_protocol: nextProto,
                      docker_unix_path:
                        nextProto === 'unix'
                          ? form.docker_unix_path || '/var/run/docker.sock'
                          : form.docker_unix_path === '/var/run/docker.sock'
                            ? ''
                            : form.docker_unix_path,
                    });
                  }}
                >
                  <option value="unix">Unix</option>
                  <option value="tcp">TCP</option>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                </select>
              </div>
            </div>

            <GroupSelectField
              value={form.group}
              onChange={(group) => setForm({ ...form, group })}
            />

            {/* Socket / Endpoint */}
            <div className="ssh-form-group">
              <label>
                {form.docker_protocol === 'unix' ? t('docker_unix_path') : t('docker_endpoint')}
              </label>
              <input
                type="text"
                value={form.docker_unix_path}
                onChange={(e) => setForm({ ...form, docker_unix_path: e.target.value })}
                placeholder={
                  form.docker_protocol === 'unix' ? '/var/run/docker.sock' : '127.0.0.1:2375'
                }
              />
            </div>

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
              {form.docker_connect_method === 'SSH' && (
                <div className="ssh-form-group">
                  <label>{t('docker_ssh_tunnel')}</label>
                  <select
                    value={form.docker_ssh_tunnel}
                    onChange={(e) => setForm({ ...form, docker_ssh_tunnel: e.target.value })}
                  >
                    <option value="">{t('docker_select')}</option>
                    {sshSessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
                color:
                  testState.kind === 'err'
                    ? 'var(--danger)'
                    : testState.kind === 'ok'
                      ? 'var(--success)'
                      : undefined,
              }}
            >
              {testState.kind === 'busy' ? t('docker_testing') : testState.text}
            </span>
          )}
          <div style={{ display: 'flex', gap: 12, marginLeft: 'auto' }}>
            <button
              className="ssh-footer-link"
              onClick={() => {
                void handleTest();
              }}
              disabled={testState.kind === 'busy'}
              title={t('docker_test')}
            >
              {t('docker_test')}
            </button>
            <button className="ssh-footer-link" onClick={handleSave}>
              {t('ssh_save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
