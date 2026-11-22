import React, { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

/**
 * Full-screen unlock gate. Rendered at the app root whenever `vaultLocked` is
 * true. There is intentionally no cancel/close and no Esc-to-dismiss: the only
 * way past it is a correct passphrase.
 *
 * This is purely an access gate — secrets are not decrypted here. A correct
 * passphrase only flips `vaultLocked` to false.
 */
export const UnlockScreen: React.FC = () => {
  const { t } = useTranslation();
  const setVaultLocked = useAppStore((s) => s.setVaultLocked);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !passphrase) return;
    setBusy(true);
    setError(false);
    try {
      const ok = await invoke<boolean>('vault_verify', { passphrase });
      if (ok) {
        setPassphrase('');
        setVaultLocked(false);
      } else {
        setError(true);
        setPassphrase('');
        inputRef.current?.focus();
      }
    } catch {
      setError(true);
      setPassphrase('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
        // Block any interaction with the app underneath.
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          padding: '36px 40px',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-lg)',
          width: 360,
          maxWidth: '92vw',
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 'var(--radius-md)',
            background: 'var(--accent-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-primary)',
          }}
        >
          <Lock size={24} />
        </div>
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>
          {t('vault_unlock_title')}
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          {t('vault_unlock_desc')}
        </div>
        <input
          ref={inputRef}
          type="password"
          value={passphrase}
          onChange={(e) => {
            setPassphrase(e.target.value);
            if (error) setError(false);
          }}
          placeholder={t('vault_passphrase_placeholder')}
          autoComplete="current-password"
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            border: `1px solid ${error ? 'var(--danger)' : 'var(--border-color)'}`,
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            fontSize: 13,
            outline: 'none',
          }}
        />
        {error && (
          <div style={{ fontSize: 12, color: 'var(--danger)' }}>{t('vault_wrong_passphrase')}</div>
        )}
        <button
          type="submit"
          disabled={busy || !passphrase}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            background: 'var(--accent-primary)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: busy || !passphrase ? 'default' : 'pointer',
            opacity: busy || !passphrase ? 0.55 : 1,
          }}
        >
          {t('vault_unlock_btn')}
        </button>
      </form>
    </div>
  );
};

export default UnlockScreen;
