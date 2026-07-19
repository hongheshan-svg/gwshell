import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../../hooks/useToast';

/**
 * One-time warning shown when the OS keyring is unavailable, in which case the
 * backend stores SSH/proxy passwords and TOTP secrets UNENCRYPTED in the local
 * database. Without this the degradation is silent. Only triggers on hosts
 * without a keyring backend (e.g. headless/minimal Linux); macOS and Windows
 * have native backends and never see it.
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
