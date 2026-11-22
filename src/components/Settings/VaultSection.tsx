import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Row, SectionTitle } from './SettingsControls';

/**
 * Master-passphrase app lock section. Talks to `vault_*` IPC directly and is
 * not part of the `AppSettings` blob (enabled state lives only in the backend
 * Argon2id verifier).
 */
export const VaultSection: React.FC<{ open: boolean }> = ({ open }) => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [newPass2, setNewPass2] = useState('');
  const [curPass, setCurPass] = useState('');
  const [chgNew, setChgNew] = useState('');
  const [chgNew2, setChgNew2] = useState('');
  const [disPass, setDisPass] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(() => {
    invoke<boolean>('vault_is_enabled')
      .then(setEnabled)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (open) {
      refresh();
      setMsg(null);
      setNewPass('');
      setNewPass2('');
      setCurPass('');
      setChgNew('');
      setChgNew2('');
      setDisPass('');
    }
  }, [open, refresh]);

  const inputStyle: React.CSSProperties = { width: 200 };

  const handleEnable = async () => {
    setMsg(null);
    if (!newPass) {
      setMsg({ kind: 'err', text: t('vault_err_empty') });
      return;
    }
    if (newPass !== newPass2) {
      setMsg({ kind: 'err', text: t('vault_err_mismatch') });
      return;
    }
    try {
      await invoke('vault_set_passphrase', { passphrase: newPass });
      setNewPass('');
      setNewPass2('');
      setMsg({ kind: 'ok', text: t('vault_enabled_ok') });
      refresh();
    } catch {
      setMsg({ kind: 'err', text: t('vault_err_generic') });
    }
  };

  const handleChange = async () => {
    setMsg(null);
    if (!chgNew) {
      setMsg({ kind: 'err', text: t('vault_err_empty') });
      return;
    }
    if (chgNew !== chgNew2) {
      setMsg({ kind: 'err', text: t('vault_err_mismatch') });
      return;
    }
    try {
      const ok = await invoke<boolean>('vault_change_passphrase', {
        currentPassphrase: curPass,
        newPassphrase: chgNew,
      });
      if (!ok) {
        setMsg({ kind: 'err', text: t('vault_err_wrong_current') });
        return;
      }
      setCurPass('');
      setChgNew('');
      setChgNew2('');
      setMsg({ kind: 'ok', text: t('vault_changed_ok') });
      refresh();
    } catch {
      setMsg({ kind: 'err', text: t('vault_err_generic') });
    }
  };

  const handleDisable = async () => {
    setMsg(null);
    try {
      const cleared = await invoke<boolean>('vault_clear', { currentPassphrase: disPass });
      if (!cleared) {
        setMsg({ kind: 'err', text: t('vault_err_wrong_current') });
        return;
      }
      setDisPass('');
      setMsg({ kind: 'ok', text: t('vault_disabled_ok') });
      refresh();
    } catch {
      setMsg({ kind: 'err', text: t('vault_err_generic') });
    }
  };

  return (
    <>
      <SectionTitle>{t('vault_section')}</SectionTitle>
      <div className="settings-col" style={{ maxWidth: 560 }}>
        <p className="settings-desc" style={{ marginBottom: 8 }}>
          {t('vault_intro')}
        </p>
        <Row label={t('vault_status')}>
          <span className="settings-label">
            {enabled ? t('vault_status_on') : t('vault_status_off')}
          </span>
        </Row>

        {!enabled ? (
          <>
            <Row label={t('vault_new_passphrase')}>
              <input
                type="password"
                className="settings-input"
                style={inputStyle}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                autoComplete="new-password"
              />
            </Row>
            <Row label={t('vault_confirm_passphrase')}>
              <input
                type="password"
                className="settings-input"
                style={inputStyle}
                value={newPass2}
                onChange={(e) => setNewPass2(e.target.value)}
                autoComplete="new-password"
              />
            </Row>
            <Row label="">
              <button
                type="button"
                className="settings-btn-primary"
                onClick={() => {
                  void handleEnable();
                }}
              >
                {t('vault_enable_btn')}
              </button>
            </Row>
          </>
        ) : (
          <>
            <SectionTitle>{t('vault_change_title')}</SectionTitle>
            <Row label={t('vault_current_passphrase')}>
              <input
                type="password"
                className="settings-input"
                style={inputStyle}
                value={curPass}
                onChange={(e) => setCurPass(e.target.value)}
                autoComplete="current-password"
              />
            </Row>
            <Row label={t('vault_new_passphrase')}>
              <input
                type="password"
                className="settings-input"
                style={inputStyle}
                value={chgNew}
                onChange={(e) => setChgNew(e.target.value)}
                autoComplete="new-password"
              />
            </Row>
            <Row label={t('vault_confirm_passphrase')}>
              <input
                type="password"
                className="settings-input"
                style={inputStyle}
                value={chgNew2}
                onChange={(e) => setChgNew2(e.target.value)}
                autoComplete="new-password"
              />
            </Row>
            <Row label="">
              <button
                type="button"
                className="settings-btn-primary"
                onClick={() => {
                  void handleChange();
                }}
              >
                {t('vault_change_btn')}
              </button>
            </Row>

            <SectionTitle>{t('vault_disable_title')}</SectionTitle>
            <p className="settings-desc" style={{ marginBottom: 8 }}>
              {t('vault_disable_desc')}
            </p>
            <Row label={t('vault_current_passphrase')}>
              <input
                type="password"
                className="settings-input"
                style={inputStyle}
                value={disPass}
                onChange={(e) => setDisPass(e.target.value)}
                autoComplete="current-password"
              />
            </Row>
            <Row label="">
              <button
                type="button"
                className="settings-btn-danger"
                onClick={() => {
                  void handleDisable();
                }}
              >
                {t('vault_disable_btn')}
              </button>
            </Row>
          </>
        )}

        {msg && (
          <p
            className="settings-desc"
            style={{ marginTop: 8, color: msg.kind === 'err' ? 'var(--danger)' : 'var(--success)' }}
          >
            {msg.text}
          </p>
        )}
      </div>
    </>
  );
};
