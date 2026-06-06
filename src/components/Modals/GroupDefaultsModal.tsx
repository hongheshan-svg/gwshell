import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { loadGroupDefaults, saveGroupDefaults } from '../../lib/groupDefaults';
import type { GroupDefaults } from '../../lib/groupDefaults';

export const GroupDefaultsModal: React.FC = () => {
  const { t } = useTranslation();
  const { groupDefaultsTarget, setGroupDefaultsTarget } = useAppStore();
  const group = groupDefaultsTarget!; // App gates render with non-null check

  const [defs, setDefs] = useState<GroupDefaults>(() => loadGroupDefaults()[group] ?? {});

  // Reset defs when group changes
  useEffect(() => {
    setDefs(loadGroupDefaults()[group] ?? {});
  }, [group]);

  const close = () => setGroupDefaultsTarget(null);

  const set = <K extends keyof GroupDefaults>(key: K, value: GroupDefaults[K] | '') => {
    setDefs((prev) => {
      const next = { ...prev };
      if (value === '' || value === undefined || value === null) {
        delete next[key];
      } else {
        next[key] = value as GroupDefaults[K];
      }
      return next;
    });
  };

  const save = () => {
    // Clean up empty/undefined entries
    const cleaned: GroupDefaults = {};
    for (const [k, v] of Object.entries(defs)) {
      if (v !== undefined && v !== null && v !== '') {
        (cleaned as Record<string, unknown>)[k] = v;
      }
    }
    const all = loadGroupDefaults();
    all[group] = cleaned;
    saveGroupDefaults(all);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <div className="group-defaults-overlay" onMouseDown={close} onKeyDown={onKeyDown}>
      <div
        className="group-defaults-card"
        onMouseDown={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="group-defaults-title">
          {t('group_defaults_title')}: <span className="group-defaults-group-name">{group}</span>
        </div>
        <div className="group-defaults-hint">{t('group_defaults_hint')}</div>

        <div className="group-defaults-form">
          {/* Username */}
          <label className="group-defaults-label">Username</label>
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
            onChange={(e) => {
              const v = e.target.value;
              set('port', v === '' ? '' : parseInt(v, 10) as unknown as undefined);
            }}
            placeholder="22"
            min={1}
            max={65535}
          />

          {/* Auth Method */}
          <label className="group-defaults-label">{t('ssh_auth_method')}</label>
          <select
            className="group-defaults-input"
            value={defs.auth_method ?? ''}
            onChange={(e) => set('auth_method', e.target.value as GroupDefaults['auth_method'] || undefined)}
          >
            <option value="">— {t('group_defaults_hint').split(' ')[0]} —</option>
            <option value="password">password</option>
            <option value="publickey">publickey</option>
            <option value="agent">agent</option>
            <option value="keyboardinteractive">keyboardinteractive</option>
            <option value="none">none</option>
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
            onChange={(e) => {
              const v = e.target.value;
              set('jump_port', v === '' ? '' : parseInt(v, 10) as unknown as undefined);
            }}
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
          <label className="group-defaults-label">Jump Private Key</label>
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
            onChange={(e) => set('proxy_type', e.target.value as GroupDefaults['proxy_type'] || undefined)}
          >
            <option value="">—</option>
            <option value="none">none</option>
            <option value="socks5">socks5</option>
            <option value="http">http</option>
          </select>

          {/* Proxy Host */}
          <label className="group-defaults-label">Proxy Host</label>
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
            onChange={(e) => {
              const v = e.target.value;
              set('proxy_port', v === '' ? '' : parseInt(v, 10) as unknown as undefined);
            }}
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
          <button className="group-defaults-btn" onClick={close}>{t('group_defaults_cancel')}</button>
          <button className="group-defaults-btn primary" onClick={save}>{t('group_defaults_save')}</button>
        </div>
      </div>
    </div>
  );
};
