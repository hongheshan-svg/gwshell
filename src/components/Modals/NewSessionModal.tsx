import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../../stores/appStore';
import { useEscapeClose } from '../../lib/useEscapeClose';
import type { SessionConfig } from '../../types';
import type { TranslationKeys } from '../../i18n';
import { SessionModalShell } from './SessionModalShell';
import { SshStandardTab } from './sshTabs/SshStandardTab';
import { SshTunnelTab } from './sshTabs/SshTunnelTab';
import { SshProxyTab } from './sshTabs/SshProxyTab';
import { SshEnvTab } from './sshTabs/SshEnvTab';
import { SshAdvancedTab } from './sshTabs/SshAdvancedTab';

const configTabKeys: { id: string; labelKey: TranslationKeys }[] = [
  { id: 'standard', labelKey: 'ssh_tab_standard' },
  { id: 'tunnel', labelKey: 'ssh_tab_tunnel' },
  { id: 'proxy', labelKey: 'ssh_tab_proxy' },
  { id: 'env', labelKey: 'ssh_tab_env' },
  { id: 'advanced', labelKey: 'ssh_tab_advanced' },
];

type AuthType = 'password' | 'publickey' | 'keyboardinteractive' | 'agent' | 'none';
type SecretField = 'password' | 'totp_code' | 'jump_password' | 'proxy_password';

const INITIAL_FORM: Partial<SessionConfig> = {
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
};

export const NewSessionModal: React.FC = () => {
  const showNewSession = useAppStore((s) => s.showNewSession);
  const setShowNewSession = useAppStore((s) => s.setShowNewSession);
  const addSession = useAppStore((s) => s.addSession);
  const addTab = useAppStore((s) => s.addTab);
  const editingSession = useAppStore((s) => s.editingSession);
  const setEditingSession = useAppStore((s) => s.setEditingSession);
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState('standard');
  const [showPassword, setShowPassword] = useState(false);
  const [showJumpPassword, setShowJumpPassword] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [dirtySecrets, setDirtySecrets] = useState<ReadonlySet<SecretField>>(new Set());
  const [form, setForm] = useState<Partial<SessionConfig>>(INITIAL_FORM);

  React.useEffect(() => {
    if (!showNewSession) return;
    setDirtySecrets(new Set());
    setTouched({});
    setActiveTab('standard');
    setShowPassword(false);
    setShowJumpPassword(false);
    setForm(editingSession ?? INITIAL_FORM);
  }, [editingSession, showNewSession]);

  const handleClose = () => {
    setShowNewSession(false);
    setEditingSession(null);
  };
  useEscapeClose(handleClose);

  if (!showNewSession) return null;

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const setSecret = (field: SecretField, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setDirtySecrets((prev) => new Set(prev).add(field));
  };

  const secretPlaceholder = (fallback = '') =>
    editingSession ? t('secret_keep_placeholder') : fallback;

  const secretValue = (field: SecretField): string | undefined => {
    const value = form[field];
    if (value) return value;
    return editingSession && dirtySecrets.has(field) ? '' : undefined;
  };

  const handleChangeAuthMethod = (method: AuthType) => {
    if (form.auth_method === method) return;
    setForm({ ...form, auth_method: method, password: '' });
    setDirtySecrets((prev) => new Set(prev).add('password'));
  };

  const buildConfig = (sessionId: string): SessionConfig => {
    const now = new Date().toISOString().slice(0, 10);
    return {
      id: sessionId,
      name: form.name!,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      session_type: form.session_type || 'ssh',
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      group: form.group || undefined,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      host: form.host || undefined,
      port: form.port ?? 22,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      username: form.username || undefined,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      auth_method: form.auth_method || 'password',
      password: secretValue('password'),
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      private_key_path: form.private_key_path || undefined,
      totp_code: secretValue('totp_code'),
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      remark: form.remark || undefined,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      color_label: form.color_label || undefined,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      environment: form.environment || undefined,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      jump_host: form.jump_host || undefined,
      jump_port: form.jump_port ?? undefined,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      jump_username: form.jump_username || undefined,
      jump_password: secretValue('jump_password'),
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      jump_private_key_path: form.jump_private_key_path || undefined,
      proxy_type: form.proxy_type && form.proxy_type !== 'none' ? form.proxy_type : undefined,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      proxy_host: form.proxy_host || undefined,
      proxy_port: form.proxy_port ?? undefined,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      proxy_username: form.proxy_username || undefined,
      proxy_password: secretValue('proxy_password'),
      tunnel_enabled: form.tunnel_enabled ?? undefined,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      tunnel_type: form.tunnel_type || 'local',
      tunnel_local_port: form.tunnel_local_port ?? undefined,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      tunnel_remote_host: form.tunnel_remote_host || undefined,
      tunnel_remote_port: form.tunnel_remote_port ?? undefined,
      keepalive_interval: form.keepalive_interval ?? undefined,
      connection_timeout: form.connection_timeout ?? undefined,
      server_alive_count_max: form.server_alive_count_max ?? undefined,
      idle_disconnect_minutes: form.idle_disconnect_minutes ?? undefined,
      compression: form.compression ?? undefined,
      agent_forward: form.agent_forward ?? undefined,
      remote_shell:
        form.remote_shell && form.remote_shell !== 'auto' ? form.remote_shell : undefined,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      env_vars: form.env_vars || undefined,
      created_at: editingSession?.created_at ?? now,
    };
  };

  const handleSave = () => {
    setTouched({ name: true, host: true });
    if (!form.name || !form.host) return;
    const sessionId = editingSession?.id ?? crypto.randomUUID();
    addSession(buildConfig(sessionId));
    handleClose();
  };

  const handleTestConnect = () => {
    setTouched({ name: true, host: true });
    if (!form.name || !form.host) return;

    const sessionId = editingSession?.id ?? crypto.randomUUID();
    const config = buildConfig(sessionId);
    addSession(config);

    const existingTab = useAppStore.getState().tabs.find((tb) => tb.sessionId === sessionId);
    if (existingTab) {
      useAppStore.getState().setActiveTab(existingTab.id);
    } else {
      addTab({
        id: crypto.randomUUID(),
        sessionId,
        title: config.name,
        type: config.session_type,
        connected: false,
      });
    }
    handleClose();
  };

  const pickKeyFile = async (field: 'private_key_path' | 'jump_private_key_path') => {
    try {
      const selected = await dialogOpen({ multiple: false, title: t('ssh_select_key_file') });
      if (typeof selected === 'string' && selected) {
        setForm((prev) => ({ ...prev, [field]: selected }));
      }
    } catch {
      /* canceled */
    }
  };

  const title = editingSession
    ? t('ssh_config_title_edit', { name: editingSession.name })
    : t('ssh_config_title_new');

  const tabs = configTabKeys.map((tab) => ({ id: tab.id, label: t(tab.labelKey) }));

  return (
    <SessionModalShell
      title={title}
      tabs={tabs}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      onClose={handleClose}
      footer={
        <>
          <button className="ssh-footer-link" onClick={handleTestConnect}>
            {t('ssh_test_connect')}
          </button>
          <div className="ssh-footer-actions">
            <button className="ssh-footer-link" onClick={handleClose}>
              {t('common_cancel')}
            </button>
            <button className="ssh-footer-link ssh-footer-primary" onClick={handleSave}>
              {t('ssh_save')}
            </button>
          </div>
        </>
      }
    >
      {activeTab === 'standard' && (
        <SshStandardTab
          form={form}
          setForm={setForm}
          nameError={Boolean(touched.name && !form.name)}
          hostError={Boolean(touched.host && !form.host)}
          onBlur={handleBlur}
          showPassword={showPassword}
          onToggleShowPassword={() => setShowPassword((v) => !v)}
          onChangeAuthMethod={handleChangeAuthMethod}
          setSecret={setSecret}
          secretPlaceholder={secretPlaceholder}
          onPickKeyFile={() => {
            void pickKeyFile('private_key_path');
          }}
        />
      )}

      {activeTab === 'tunnel' && <SshTunnelTab form={form} setForm={setForm} />}

      {activeTab === 'proxy' && (
        <SshProxyTab
          form={form}
          setForm={setForm}
          setSecret={setSecret}
          secretPlaceholder={secretPlaceholder}
        />
      )}

      {activeTab === 'env' && <SshEnvTab form={form} setForm={setForm} />}

      {activeTab === 'advanced' && (
        <SshAdvancedTab
          form={form}
          setForm={setForm}
          showJumpPassword={showJumpPassword}
          onToggleShowJumpPassword={() => setShowJumpPassword((v) => !v)}
          setSecret={setSecret}
          secretPlaceholder={secretPlaceholder}
          onPickJumpKeyFile={() => {
            void pickKeyFile('jump_private_key_path');
          }}
        />
      )}
    </SessionModalShell>
  );
};
