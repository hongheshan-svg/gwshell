import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionConfig } from '../../../types';

interface SshEnvTabProps {
  form: Partial<SessionConfig>;
  setForm: React.Dispatch<React.SetStateAction<Partial<SessionConfig>>>;
}

export const SshEnvTab: React.FC<SshEnvTabProps> = ({ form, setForm }) => {
  const { t } = useTranslation();

  return (
    <>
      <div className="ssh-form-group">
        <label>{t('ssh_env_custom')}</label>
        <textarea
          className="ssh-remark"
          rows={10}
          placeholder={'KEY=VALUE\nPATH=/custom/path\nLANG=en_US.UTF-8'}
          value={form.env_vars ?? ''}
          onChange={(e) => setForm({ ...form, env_vars: e.target.value })}
        />
      </div>
      <div className="ssh-tab-desc">{t('ssh_env_desc')}</div>
    </>
  );
};
