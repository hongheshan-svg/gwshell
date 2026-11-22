import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionConfig } from '../../../types';

interface SshTunnelTabProps {
  form: Partial<SessionConfig>;
  setForm: React.Dispatch<React.SetStateAction<Partial<SessionConfig>>>;
}

export const SshTunnelTab: React.FC<SshTunnelTabProps> = ({ form, setForm }) => {
  const { t } = useTranslation();

  return (
    <>
      <div className="ssh-form-group">
        <label>{t('ssh_tunnel_label')}</label>
        <label className="ssh-toggle-label">
          <input
            type="checkbox"
            checked={form.tunnel_enabled ?? false}
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
              value={form.tunnel_type ?? 'local'}
              onChange={(e) =>
                setForm({
                  ...form,
                  tunnel_type: e.target.value as 'local' | 'remote' | 'dynamic', // eslint-disable-line no-restricted-syntax -- select value union; runtime-validated by onChange
                })
              }
            >
              <option value="local">{t('ssh_tunnel_local')}</option>
              <option value="remote">{t('ssh_tunnel_remote')}</option>
              <option value="dynamic">{t('ssh_tunnel_dynamic')}</option>
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
                value={form.tunnel_local_port ?? ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    tunnel_local_port: parseInt(e.target.value) || undefined,
                  })
                }
              />
            </div>
            <div className="ssh-form-group" />
          </div>

          {form.tunnel_type !== 'dynamic' && (
            <>
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>{t('ssh_tunnel_remote_host')}</label>
                  <input
                    type="text"
                    placeholder="localhost"
                    value={form.tunnel_remote_host ?? ''}
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
                    value={form.tunnel_remote_port ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        tunnel_remote_port: parseInt(e.target.value) || undefined,
                      })
                    }
                  />
                </div>
              </div>

              {form.tunnel_local_port && form.tunnel_remote_host && form.tunnel_remote_port && (
                <div className="ssh-tab-desc">
                  {t('ssh_tunnel_desc', {
                    localPort: form.tunnel_local_port,
                    remoteHost: form.tunnel_remote_host,
                    remotePort: form.tunnel_remote_port,
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {!form.tunnel_enabled && (
        <div className="ssh-tab-placeholder">
          <p>{t('ssh_tunnel_enable_hint')}</p>
        </div>
      )}
    </>
  );
};
