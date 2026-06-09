import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ShieldAlert, X } from 'lucide-react';

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
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Don't show if previously dismissed
    if (localStorage.getItem(DISMISSED_KEY)) return;
    let cancelled = false;
    invoke<boolean>('secret_storage_available')
      .then((available) => {
        if (!cancelled && available === false) setShow(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  return (
    <div className="update-toast security-notice" role="alert">
      <ShieldAlert size={16} className="security-notice-icon" />
      <div className="update-toast-text">
        <strong>{t('secret_storage_warning_title')}</strong>
        <span>{t('secret_storage_warning_body')}</span>
      </div>
      <button className="update-toast-btn" onClick={() => {
        localStorage.setItem(DISMISSED_KEY, '1');
        setShow(false);
      }}>
        <X size={12} />
      </button>
    </div>
  );
};
