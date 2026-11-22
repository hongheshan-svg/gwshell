import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { loadGroupDefaults, saveGroupDefaults } from '../../lib/groupDefaults';
import type { GroupDefaults } from '../../lib/groupDefaults';
import { useEscapeClose } from '../../lib/useEscapeClose';

export const GroupDefaultsModal: React.FC = () => {
  const { t } = useTranslation();
  const groupDefaultsTarget = useAppStore((s) => s.groupDefaultsTarget);
  const setGroupDefaultsTarget = useAppStore((s) => s.setGroupDefaultsTarget);
  const group = groupDefaultsTarget!; // App gates render with non-null check

  const [defs, setDefs] = useState<GroupDefaults>(() => loadGroupDefaults()[group] ?? {});

  // Reset defs when group changes
  useEffect(() => {
    setDefs(loadGroupDefaults()[group] ?? {});
  }, [group]);

  const close = useCallback(() => setGroupDefaultsTarget(null), [setGroupDefaultsTarget]);
  useEscapeClose(close);

  const set = <K extends keyof GroupDefaults>(key: K, value: GroupDefaults[K] | '') => {
    setDefs((prev) => {
      const next = { ...prev };
      if (value === '' || value === undefined || value === null) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const setNumericField = (key: 'port' | 'jump_port' | 'proxy_port', raw: string) => {
    if (raw.trim() === '') {
      set(key, '');
      return;
    }
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      set(key, parsed);
    }
  };

  const save = () => {
    // Clean up empty/undefined entries
    const cleaned: GroupDefaults = {};
    for (const [k, v] of Object.entries(defs)) {
      if (v !== undefined && v !== null && v !== '') {
        (cleaned as Record<string, unknown>)[k] = v; // eslint-disable-line no-restricted-syntax -- dynamic field assignment on GroupDefaults; index signature required
      }
    }
    const all = loadGroupDefaults();
    all[group] = cleaned;
    saveGroupDefaults(all);
    close();
  };

  return (
    <div className="group-defaults-overlay" onMouseDown={close}>
      <div className="group-defaults-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="group-defaults-title">
          {t('group_defaults_title')}: <span className="group-defaults-group-name">{group}</span>
        </div>
        <div className="group-defaults-hint">{t('group_defaults_hint')}</div>

        <div className="group-defaults-form">
          {/* Username */}
          <label className="group-defaults-label">{t('group_defaults_username')}</label>
          <input
            className="group-defaults-input"
            type="text"
            value={defs.username ?? ''}
            onChange={(e) => set('username', e.target.value)}
            placeholder="e.g. admin"
          />

          {/* Port */}
          <label className="group-defaults-label">{t('ssh_port')}</label>
          <input
            className="group-defaults-input"
            type="number"
            value={defs.port ?? ''}
            onChange={(e) => setNumericField('port', e.target.value)}
            placeholder="22"
            min={1}
            max={65535}
          />

          {/* Auth Method */}
          <label className="group-defaults-label">{t('ssh_auth_method')}</label>
          <select
            className="group-defaults-input"
            value={defs.auth_method ?? ''}
            onChange={
              (e) =>
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                set('auth_method', (e.target.value as GroupDefaults['auth_method']) || undefined) // eslint-disable-line no-restricted-syntax -- select value union; runtime-validated by onChange
            }
          >
            <option value="">—</option>
            <option value="password">{t('ssh_auth_password')}</option>
            <option value="publickey">{t('ssh_auth_publickey')}</option>
            <option value="agent">{t('ssh_auth_agent')}</option>
            <option value="keyboardinteractive">{t('ssh_auth_mfa')}</option>
            <option value="none">{t('ssh_auth_none')}</option>
          </select>

          {/* Private Key Path */}
          <label className="group-defaults-label">{t('ssh_private_key_path')}</label>
          <input
            className="group-defaults-input"
            type="text"
            value={defs.private_key_path ?? ''}
            onChange={(e) => set('private_key_path', e.target.value)}
            placeholder="~/.ssh/id_rsa"
          />

          {/* Jump Host */}
          <label className="group-defaults-label">{t('ssh_jump_host')}</label>
          <input
            className="group-defaults-input"
            type="text"
            value={defs.jump_host ?? ''}
            onChange={(e) => set('jump_host', e.target.value)}
            placeholder="jump.example.com"
          />

          {/* Jump Port */}
          <label className="group-defaults-label">{t('ssh_jump_port')}</label>
          <input
            className="group-defaults-input"
            type="number"
            value={defs.jump_port ?? ''}
            onChange={(e) => setNumericField('jump_port', e.target.value)}
            placeholder="22"
            min={1}
            max={65535}
          />

          {/* Jump Username */}
          <label className="group-defaults-label">{t('ssh_jump_username')}</label>
          <input
            className="group-defaults-input"
            type="text"
            value={defs.jump_username ?? ''}
            onChange={(e) => set('jump_username', e.target.value)}
            placeholder="jumpuser"
          />

          {/* Jump Private Key Path */}
          <label className="group-defaults-label">{t('ssh_jump_key_path')}</label>
          <input
            className="group-defaults-input"
            type="text"
            value={defs.jump_private_key_path ?? ''}
            onChange={(e) => set('jump_private_key_path', e.target.value)}
            placeholder="~/.ssh/jump_key"
          />

          {/* Proxy Type */}
          <label className="group-defaults-label">{t('ssh_proxy_type')}</label>
          <select
            className="group-defaults-input"
            value={defs.proxy_type ?? ''}
            onChange={
              (e) =>
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                set('proxy_type', (e.target.value as GroupDefaults['proxy_type']) || undefined) // eslint-disable-line no-restricted-syntax -- select value union; runtime-validated by onChange
            }
          >
            <option value="">—</option>
            <option value="none">{t('ssh_proxy_none')}</option>
            <option value="socks5">SOCKS5</option>
            <option value="http">HTTP CONNECT</option>
          </select>

          {/* Proxy Host */}
          <label className="group-defaults-label">{t('ssh_proxy_server')}</label>
          <input
            className="group-defaults-input"
            type="text"
            value={defs.proxy_host ?? ''}
            onChange={(e) => set('proxy_host', e.target.value)}
            placeholder="proxy.example.com"
          />

          {/* Proxy Port */}
          <label className="group-defaults-label">{t('ssh_proxy_port')}</label>
          <input
            className="group-defaults-input"
            type="number"
            value={defs.proxy_port ?? ''}
            onChange={(e) => setNumericField('proxy_port', e.target.value)}
            placeholder="1080"
            min={1}
            max={65535}
          />

          {/* Proxy Username */}
          <label className="group-defaults-label">{t('ssh_proxy_username')}</label>
          <input
            className="group-defaults-input"
            type="text"
            value={defs.proxy_username ?? ''}
            onChange={(e) => set('proxy_username', e.target.value)}
            placeholder="proxyuser"
          />

          {/* Env Vars */}
          <label className="group-defaults-label">{t('ssh_env_custom')}</label>
          <textarea
            className="group-defaults-input group-defaults-textarea"
            value={defs.env_vars ?? ''}
            onChange={(e) => set('env_vars', e.target.value)}
            placeholder="KEY=VALUE"
            rows={3}
          />
        </div>

        <div className="group-defaults-actions">
          <button className="group-defaults-btn" onClick={close}>
            {t('group_defaults_cancel')}
          </button>
          <button className="group-defaults-btn primary" onClick={save}>
            {t('group_defaults_save')}
          </button>
        </div>
      </div>
    </div>
  );
};
