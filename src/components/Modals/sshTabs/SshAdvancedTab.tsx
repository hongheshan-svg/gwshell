import React from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, FolderOpen } from 'lucide-react';
import type { SessionConfig } from '../../../types';

interface SshAdvancedTabProps {
  form: Partial<SessionConfig>;
  setForm: React.Dispatch<React.SetStateAction<Partial<SessionConfig>>>;
  showJumpPassword: boolean;
  onToggleShowJumpPassword: () => void;
  setSecret: (field: 'jump_password', value: string) => void;
  secretPlaceholder: (fallback?: string) => string;
  onPickJumpKeyFile: () => void;
}

export const SshAdvancedTab: React.FC<SshAdvancedTabProps> = ({
  form,
  setForm,
  showJumpPassword,
  onToggleShowJumpPassword,
  setSecret,
  secretPlaceholder,
  onPickJumpKeyFile,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <div className="ssh-form-row">
        <div className="ssh-form-group">
          <label>{t('ssh_conn_timeout')}</label>
          <input
            type="number"
            min={0}
            placeholder="30"
            value={form.connection_timeout ?? ''}
            onChange={(e) =>
              setForm({
                ...form,
                connection_timeout: parseInt(e.target.value) || undefined,
              })
            }
          />
        </div>
        <div className="ssh-form-group">
          <label>{t('ssh_keepalive')}</label>
          <input
            type="number"
            min={0}
            placeholder="60"
            value={form.keepalive_interval ?? ''}
            onChange={(e) =>
              setForm({
                ...form,
                keepalive_interval: parseInt(e.target.value) || undefined,
              })
            }
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
            value={form.server_alive_count_max ?? ''}
            onChange={(e) =>
              setForm({
                ...form,
                server_alive_count_max: parseInt(e.target.value) || undefined,
              })
            }
          />
        </div>
        <div className="ssh-form-group">
          <label>{t('ssh_idle_disconnect')}</label>
          <input
            type="number"
            min={0}
            placeholder="0"
            value={form.idle_disconnect_minutes ?? ''}
            onChange={(e) =>
              setForm({
                ...form,
                idle_disconnect_minutes: parseInt(e.target.value) || undefined,
              })
            }
          />
        </div>
      </div>

      <div className="ssh-form-row">
        <div className="ssh-form-group">
          <label style={{ visibility: 'hidden' }}>{t('common_placeholder')}</label>
          <label className="ssh-toggle-label">
            <input
              type="checkbox"
              checked={form.agent_forward ?? false}
              onChange={(e) => setForm({ ...form, agent_forward: e.target.checked })}
            />
            <span>{t('ssh_agent_forward')}</span>
          </label>
          <label className="ssh-toggle-label" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={form.compression ?? false}
              onChange={(e) => setForm({ ...form, compression: e.target.checked })}
            />
            <span>{t('ssh_compression')}</span>
          </label>
        </div>
        <div className="ssh-form-group">
          <label>{t('ssh_remote_shell')}</label>
          <select
            value={form.remote_shell ?? 'auto'}
            onChange={(e) =>
              setForm({
                ...form,
                remote_shell: e.target.value as 'auto' | 'linux' | 'cmd' | 'powershell', // eslint-disable-line no-restricted-syntax -- select value union; runtime-validated by onChange
              })
            }
          >
            <option value="auto">{t('ssh_remote_shell_auto')}</option>
            <option value="linux">{t('ssh_remote_shell_linux')}</option>
            <option value="cmd">{t('ssh_remote_shell_cmd')}</option>
            <option value="powershell">{t('ssh_remote_shell_powershell')}</option>
          </select>
        </div>
      </div>

      <div className="ssh-section-divider">
        <span>{t('ssh_jump_title')}</span>
      </div>

      <div className="ssh-form-row">
        <div className="ssh-form-group">
          <label>{t('ssh_jump_host')}</label>
          <input
            type="text"
            placeholder="jump.example.com"
            value={form.jump_host ?? ''}
            onChange={(e) => setForm({ ...form, jump_host: e.target.value })}
          />
        </div>
        <div className="ssh-form-group">
          <label>{t('ssh_jump_port')}</label>
          <input
            type="number"
            placeholder="22"
            value={form.jump_port ?? ''}
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
                value={form.jump_username ?? ''}
                onChange={(e) => setForm({ ...form, jump_username: e.target.value })}
              />
            </div>
            <div className="ssh-form-group">
              <label>{t('ssh_jump_password')}</label>
              <div className="ssh-password-wrap">
                <input
                  type={showJumpPassword ? 'text' : 'password'}
                  autoComplete="off"
                  placeholder={secretPlaceholder()}
                  value={form.jump_password ?? ''}
                  onChange={(e) => setSecret('jump_password', e.target.value)}
                />
                <button
                  className="ssh-password-toggle"
                  onClick={onToggleShowJumpPassword}
                  type="button"
                >
                  {showJumpPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>
          <div className="ssh-form-group">
            <label>{t('ssh_jump_key_path')}</label>
            <div className="ssh-password-wrap">
              <input
                type="text"
                placeholder="~/.ssh/id_rsa"
                value={form.jump_private_key_path ?? ''}
                onChange={(e) => setForm({ ...form, jump_private_key_path: e.target.value })}
              />
              <button
                type="button"
                className="ssh-password-toggle"
                title={t('ssh_select_key_file')}
                onClick={onPickJumpKeyFile}
              >
                <FolderOpen size={14} />
              </button>
            </div>
          </div>
          <div className="ssh-tab-desc">
            {t('ssh_jump_desc', {
              jumpHost: form.jump_host,
              jumpPort: form.jump_port ?? 22,
              // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
              host: form.host || 'target',
              port: form.port ?? 22,
            })}
          </div>
        </>
      )}
    </>
  );
};
