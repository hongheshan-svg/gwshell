import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../../hooks/useToast';

/**
 * One-time warning shown when secrets cannot be encrypted at rest — no OS
 * keyring backend (e.g. headless/minimal Linux), or the keyring master key
 * exists but could not be read this run. In that case the backend does NOT
 * save SSH/proxy passwords or TOTP secrets at all (they are stored empty;
 * plaintext never reaches the database), so the user must re-enter them when
 * connecting. Without this notice the degradation would be silent.
 */
const DISMISSED_KEY = 'gwshell.securityNoticeDismissed';

export const SecurityNotice: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const surfacedRef = useRef(false);

  useEffect(() => {
    // Don't show if previously dismissed
    if (localStorage.getItem(DISMISSED_KEY)) return;
    let cancelled = false;
    invoke<boolean>('secret_storage_available')
      .then((available) => {
        if (cancelled || available !== false) return;
        if (surfacedRef.current) return;
        surfacedRef.current = true;
        // Mark dismissed so the warning doesn't re-fire on every check.
        localStorage.setItem(DISMISSED_KEY, '1');
        toast.warning({
          title: t('toast.secretStorageWarningTitle'),
          message: t('toast.secretStorageWarningBody'),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
};
