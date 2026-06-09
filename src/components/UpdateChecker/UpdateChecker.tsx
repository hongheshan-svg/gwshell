import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Download, RefreshCw, X } from 'lucide-react';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

const DISMISSED_KEY = 'gwshell.updateDismissedVersion';

export const UpdateChecker: React.FC = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<UpdateState>('idle');
  const [newVersion, setNewVersion] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [progress, setProgress] = useState(0);
  // Hold the Update handle from the initial check so Download reuses it instead
  // of issuing a second check() — that second call could return null (manifest
  // flake / already-applied) and leave the toast stuck forever on "Downloading".
  const updateRef = useRef<Update | null>(null);

  const checkForUpdate = async () => {
    setState('checking');
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setNewVersion(update.version);
        // Only show if this version hasn't been dismissed before
        const dismissedVersion = localStorage.getItem(DISMISSED_KEY);
        if (dismissedVersion === update.version) {
          setState('idle');
        } else {
          setState('available');
        }
      } else {
        setState('idle');
      }
    } catch {
      setState('idle');
    }
  };

  const downloadAndInstall = async () => {
    const update = updateRef.current;
    if (!update) {
      // No handle to install (shouldn't happen from the 'available' toast) —
      // surface the dismissible error state rather than hanging on 'downloading'.
      setState('error');
      return;
    }
    setState('downloading');
    try {
      let totalLen = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started' && event.data.contentLength) {
          totalLen = event.data.contentLength;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (totalLen > 0) {
            setProgress(Math.round((downloaded / totalLen) * 100));
          }
        } else if (event.event === 'Finished') {
          setState('ready');
        }
      });

      setState('ready');
    } catch {
      setState('error');
    }
  };

  useEffect(() => {
    let idleCallbackId: number | null = null;

    // Updates are non-critical; don't let them compete with early window interactions.
    const timer = window.setTimeout(() => {
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        idleCallbackId = window.requestIdleCallback(() => {
          void checkForUpdate();
        }, { timeout: 5000 });
      } else {
        idleCallbackId = setTimeout(() => {
          void checkForUpdate();
        }, 0);
      }
    }, 20000);

    return () => {
      clearTimeout(timer);
      if (idleCallbackId != null) {
        if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
          window.cancelIdleCallback(idleCallbackId);
        } else {
          clearTimeout(idleCallbackId);
        }
      }
    };
  }, []);

  if (dismissed || state === 'idle' || state === 'checking') return null;

  return (
    <div className="update-toast">
      {state === 'available' && (
        <>
          <div className="update-toast-text">
            <strong>{t('update_available')}</strong>
            <span>{t('update_new_version', { version: newVersion })}</span>
          </div>
          <button className="update-toast-btn primary" onClick={downloadAndInstall}>
            <Download size={12} />
            {t('update_download')}
          </button>
          <button className="update-toast-btn" onClick={() => {
            localStorage.setItem(DISMISSED_KEY, newVersion);
            setDismissed(true);
          }}>
            <X size={12} />
          </button>
        </>
      )}
      {state === 'downloading' && (
        <>
          <div className="update-toast-text">
            <strong>{t('update_downloading')}</strong>
            <span>{progress}%</span>
          </div>
          <div className="update-progress">
            <div className="update-progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </>
      )}
      {state === 'ready' && (
        <>
          <div className="update-toast-text">
            <strong>{t('update_restart')}</strong>
          </div>
          <button className="update-toast-btn primary" onClick={() => void relaunch()}>
            <RefreshCw size={12} />
            {t('update_restart_now')}
          </button>
        </>
      )}
      {state === 'error' && (
        <>
          <div className="update-toast-text">
            <span>{t('update_error')}</span>
          </div>
          <button className="update-toast-btn" onClick={() => setDismissed(true)}>
            <X size={12} />
          </button>
        </>
      )}
    </div>
  );
};
