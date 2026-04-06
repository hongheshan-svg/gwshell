import React, { useEffect, useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { Download, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

export const UpdateChecker: React.FC = () => {
  const t = useAppStore((s) => s.t);
  const [state, setState] = useState<UpdateState>('idle');
  const [newVersion, setNewVersion] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [progress, setProgress] = useState(0);

  const checkForUpdate = async () => {
    setState('checking');
    try {
      const update = await check();
      if (update) {
        setNewVersion(update.version);
        setState('available');
      } else {
        setState('idle');
      }
    } catch {
      setState('idle');
    }
  };

  const downloadAndInstall = async () => {
    setState('downloading');
    try {
      const update = await check();
      if (!update) return;

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
    // Check for updates 3 seconds after app launch
    const timer = setTimeout(checkForUpdate, 3000);
    return () => clearTimeout(timer);
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
          <button className="update-toast-btn" onClick={() => setDismissed(true)}>
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
