import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionConfig } from '../../../types';

interface SshProxyTabProps {
  form: Partial<SessionConfig>;
  setForm: React.Dispatch<React.SetStateAction<Partial<SessionConfig>>>;
  setSecret: (field: 'proxy_password', value: string) => void;
  secretPlaceholder: (fallback?: string) => string;
}

export const SshProxyTab: React.FC<SshProxyTabProps> = ({
  form,
  setForm,
  setSecret,
  secretPlaceholder,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <div className="ssh-form-group">
        <label>{t('ssh_proxy_type')}</label>
        <select
          value={form.proxy_type ?? 'none'}
          onChange={(e) =>
            setForm({
              ...form,
              // eslint-disable-next-line no-restricted-syntax
              proxy_type: e.target.value as SessionConfig['proxy_type'],
            })
          }
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
                value={form.proxy_host ?? ''}
                onChange={(e) => setForm({ ...form, proxy_host: e.target.value })}
              />
            </div>
            <div className="ssh-form-group">
              <label>{t('ssh_proxy_port')}</label>
              <input
                type="number"
                placeholder={form.proxy_type === 'socks5' ? '1080' : '8080'}
                value={form.proxy_port ?? ''}
                onChange={(e) =>
                  setForm({ ...form, proxy_port: parseInt(e.target.value) || undefined })
                }
              />
            </div>
          </div>

          <div className="ssh-form-row">
            <div className="ssh-form-group">
              <label>{t('ssh_proxy_username')}</label>
              <input
                type="text"
                value={form.proxy_username ?? ''}
                onChange={(e) => setForm({ ...form, proxy_username: e.target.value })}
              />
            </div>
            <div className="ssh-form-group">
              <label>{t('ssh_proxy_password')}</label>
              <input
                type="password"
                autoComplete="off"
                placeholder={secretPlaceholder()}
                value={form.proxy_password ?? ''}
                onChange={(e) => setSecret('proxy_password', e.target.value)}
              />
            </div>
          </div>

          <div className="ssh-tab-desc">
            {t('ssh_proxy_desc', {
              proxyType: form.proxy_type === 'socks5' ? 'SOCKS5' : 'HTTP CONNECT',
              proxyAddr: form.proxy_host
                ? ` ${form.proxy_host}:${form.proxy_port ?? (form.proxy_type === 'socks5' ? 1080 : 8080)}`
                : '',
            })}
          </div>
        </>
      )}

      {(!form.proxy_type || form.proxy_type === 'none') && (
        <div className="ssh-tab-placeholder">
          <p>{t('ssh_proxy_hint')}</p>
        </div>
      )}
    </>
  );
};
