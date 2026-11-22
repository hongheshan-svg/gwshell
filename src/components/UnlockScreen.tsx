import React, { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

/**
 * Full-screen unlock gate. Rendered at the app root whenever `vaultLocked` is
 * true. There is intentionally no cancel/close and no Esc-to-dismiss: the only
 * way past it is a correct passphrase.
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
        backgroundColor: 'var(--bg-shell)',
        backgroundImage:
          'radial-gradient(60% 50% at 50% 35%, rgba(var(--accent-primary-rgb), 0.14) 0%, transparent 100%)',
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
          gap: 14,
          padding: '36px 36px 32px',
          borderRadius: 'var(--radius-xl)',
          background: 'var(--chrome-bg)',
          backdropFilter: 'blur(var(--surface-blur))',
          WebkitBackdropFilter: 'blur(var(--surface-blur))',
          border: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-lg)',
          width: 368,
          maxWidth: '92vw',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 'var(--radius-lg)',
            background: 'var(--accent-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-fg)',
            boxShadow:
              '0 10px 28px -6px rgba(var(--accent-primary-rgb), 0.5), inset 0 1px 0 rgba(255,255,255,0.28)',
            marginBottom: 4,
          }}
        >
          <Lock size={24} />
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 650,
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
          }}
        >
          {t('vault_unlock_title')}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--text-secondary)',
            textAlign: 'center',
            lineHeight: 1.5,
            marginBottom: 4,
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
            height: 38,
            padding: '0 12px',
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
            height: 38,
            borderRadius: 'var(--radius-sm)',
            border: '1px solid rgba(var(--accent-primary-rgb), 0.45)',
            background: 'var(--accent-gradient)',
            color: 'var(--accent-fg)',
            fontSize: 13,
            fontWeight: 600,
            cursor: busy || !passphrase ? 'default' : 'pointer',
            opacity: busy || !passphrase ? 0.5 : 1,
            boxShadow: '0 4px 14px -4px rgba(var(--accent-primary-rgb), 0.45)',
          }}
        >
          {t('vault_unlock_btn')}
        </button>
      </form>
    </div>
  );
};

export default UnlockScreen;
