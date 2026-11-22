import React from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, FolderOpen } from 'lucide-react';
import type { SessionConfig } from '../../../types';
import type { TranslationKeys } from '../../../i18n';
import { ColorLabelPicker } from '../ColorLabelPicker';
import { GroupSelectField } from '../GroupSelectField';

type AuthType = 'password' | 'publickey' | 'keyboardinteractive' | 'agent' | 'none';
type SecretField = 'password' | 'totp_code' | 'jump_password' | 'proxy_password';

const AUTH_METHODS: { id: AuthType; labelKey: TranslationKeys }[] = [
  { id: 'password', labelKey: 'ssh_auth_password' },
  { id: 'publickey', labelKey: 'ssh_auth_publickey' },
  { id: 'keyboardinteractive', labelKey: 'ssh_auth_mfa' },
  { id: 'agent', labelKey: 'ssh_auth_agent' },
  { id: 'none', labelKey: 'ssh_auth_none' },
];

interface SshStandardTabProps {
  form: Partial<SessionConfig>;
  setForm: React.Dispatch<React.SetStateAction<Partial<SessionConfig>>>;
  nameError: boolean;
  hostError: boolean;
  onBlur: (field: string) => void;
  showPassword: boolean;
  onToggleShowPassword: () => void;
  onChangeAuthMethod: (method: AuthType) => void;
  setSecret: (field: SecretField, value: string) => void;
  secretPlaceholder: (fallback?: string) => string;
  onPickKeyFile: () => void;
}

export const SshStandardTab: React.FC<SshStandardTabProps> = ({
  form,
  setForm,
  nameError,
  hostError,
  onBlur,
  showPassword,
  onToggleShowPassword,
  onChangeAuthMethod,
  setSecret,
  secretPlaceholder,
  onPickKeyFile,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <div className="ssh-form-row">
        <div className="ssh-form-group">
          <label className={nameError ? 'label-error' : ''}>
            {t('ssh_name')} <span className="required-mark">*</span>
          </label>
          <input
            type="text"
            value={form.name ?? ''}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onBlur={() => onBlur('name')}
            className={nameError ? 'input-error' : ''}
          />
          {nameError && <span className="field-error">{t('field_required')}</span>}
        </div>
        <div className="ssh-form-group">
          <label className={hostError ? 'label-error' : ''}>
            {t('ssh_host')} <span className="required-mark">*</span>
          </label>
          <input
            type="text"
            value={form.host ?? ''}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
            onBlur={() => onBlur('host')}
            className={hostError ? 'input-error' : ''}
          />
          {hostError && <span className="field-error">{t('field_required')}</span>}
        </div>
      </div>

      <div className="ssh-form-row">
        <div className="ssh-form-group">
          <label>{t('ssh_user')}</label>
          <input
            type="text"
            value={form.username ?? ''}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </div>
        <div className="ssh-form-group">
          <label>{t('ssh_port')}</label>
          <input
            type="number"
            min={1}
            max={65535}
            value={form.port ?? 22}
            onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 22 })}
          />
        </div>
      </div>

      <div className="ssh-form-row">
        <ColorLabelPicker
          value={form.color_label ?? ''}
          onChange={(color_label) => setForm({ ...form, color_label })}
        />
        <div className="ssh-form-group">
          <label>{t('ssh_environment')}</label>
          <select
            value={form.environment ?? ''}
            onChange={(e) => setForm({ ...form, environment: e.target.value })}
          >
            <option value="">{t('ssh_env_none')}</option>
            <option value="dev">{t('ssh_env_dev')}</option>
            <option value="staging">{t('ssh_env_staging')}</option>
            <option value="production">{t('ssh_env_production')}</option>
          </select>
        </div>
      </div>

      <GroupSelectField
        value={form.group ?? ''}
        onChange={(group) => setForm({ ...form, group })}
      />

      <div className="ssh-form-group">
        <label>{t('ssh_auth_method')}</label>
        <div className="ssh-auth-row">
          {AUTH_METHODS.map((btn) => (
            <button
              key={btn.id}
              type="button"
              className={`ssh-auth-btn ${form.auth_method === btn.id ? 'active' : ''}`}
              onClick={() => onChangeAuthMethod(btn.id)}
            >
              {t(btn.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {form.auth_method === 'password' && (
        <div className="ssh-form-group">
          <label>{t('ssh_password')}</label>
          <div className="ssh-password-wrap">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="off"
              placeholder={secretPlaceholder()}
              value={form.password ?? ''}
              onChange={(e) => setSecret('password', e.target.value)}
            />
            <button className="ssh-password-toggle" onClick={onToggleShowPassword} type="button">
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
      )}

      {form.auth_method === 'publickey' && (
        <>
          <div className="ssh-form-group">
            <label>{t('ssh_private_key_path')}</label>
            <div className="ssh-password-wrap">
              <input
                type="text"
                placeholder="~/.ssh/id_rsa"
                value={form.private_key_path ?? ''}
                onChange={(e) => setForm({ ...form, private_key_path: e.target.value })}
              />
              <button
                type="button"
                className="ssh-password-toggle"
                title={t('ssh_select_key_file')}
                onClick={onPickKeyFile}
              >
                <FolderOpen size={14} />
              </button>
            </div>
          </div>
          <div className="ssh-form-group">
            <label>{t('ssh_key_passphrase_label')}</label>
            <div className="ssh-password-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="off"
                placeholder={secretPlaceholder()}
                value={form.password ?? ''}
                onChange={(e) => setSecret('password', e.target.value)}
              />
              <button className="ssh-password-toggle" onClick={onToggleShowPassword} type="button">
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <div className="ssh-tab-desc" style={{ marginTop: 4 }}>
              {t('ssh_key_passphrase_hint')}
            </div>
          </div>
        </>
      )}

      {form.auth_method === 'keyboardinteractive' && (
        <>
          <div className="ssh-form-group">
            <label>{t('ssh_mfa_password_hint')}</label>
            <div className="ssh-password-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="off"
                placeholder={secretPlaceholder(t('ssh_mfa_password_placeholder'))}
                value={form.password ?? ''}
                onChange={(e) => setSecret('password', e.target.value)}
              />
              <button className="ssh-password-toggle" onClick={onToggleShowPassword} type="button">
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div className="ssh-form-group">
            <label>{t('ssh_mfa_totp_label')}</label>
            <input
              type="password"
              autoComplete="off"
              placeholder={secretPlaceholder(t('ssh_mfa_totp_placeholder'))}
              value={form.totp_code ?? ''}
              onChange={(e) => setSecret('totp_code', e.target.value)}
            />
          </div>
          <div className="ssh-tab-desc">{t('ssh_mfa_desc')}</div>
        </>
      )}

      {form.auth_method === 'agent' && <div className="ssh-tab-desc">{t('ssh_agent_desc')}</div>}

      {form.auth_method === 'none' && <div className="ssh-tab-desc">{t('ssh_noauth_desc')}</div>}

      <div className="ssh-form-group">
        <label>{t('ssh_remark')}</label>
        <textarea
          rows={2}
          value={form.remark ?? ''}
          onChange={(e) => setForm({ ...form, remark: e.target.value })}
        />
      </div>
    </>
  );
};
