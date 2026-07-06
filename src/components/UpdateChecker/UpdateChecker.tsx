import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useToast } from '../../hooks/useToast';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

const DISMISSED_KEY = 'gwshell.updateDismissedVersion';

export const UpdateChecker: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const [state, setState] = useState<UpdateState>('idle');
  const [newVersion, setNewVersion] = useState('');
  const [progress, setProgress] = useState(0);
  // Hold the Update handle from the initial check so Download reuses it instead
  // of issuing a second check() — that second call could return null (manifest
  // flake / already-applied) and leave the toast stuck forever on "Downloading".
  const updateRef = useRef<Update | null>(null);
  // Track whether the current version was already surfaced as a toast, so a
  // re-render (state flip) doesn't push a duplicate.
  const surfacedVersionRef = useRef<string | null>(null);
  // Track whether the "ready"/"error" toasts have already fired this session —
  // avoids duplicate toasts if state flips back and forth.
  const surfacedReadyRef = useRef(false);
  const surfacedErrorRef = useRef(false);

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
      setState('error');
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
        idleCallbackId = window.requestIdleCallback(
          () => {
            void checkForUpdate();
          },
          { timeout: 5000 },
        );
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

  // Surface update availability as a toast with a Download & Install action.
  useEffect(() => {
    if (state !== 'available') return;
    if (surfacedVersionRef.current === newVersion) return;
    surfacedVersionRef.current = newVersion;
    toast.info({
      title: t('toast.updateAvailable'),
      message: t('toast.updateAvailableBody', { version: newVersion }),
      action: {
        label: t('toast.updateDownload'),
        onClick: () => void downloadAndInstall(),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, newVersion]);

  // Surface "ready to restart" as a toast with a Restart action.
  useEffect(() => {
    if (state !== 'ready') return;
    if (surfacedReadyRef.current) return;
    surfacedReadyRef.current = true;
    toast.success({
      title: t('toast.updateRestart'),
      action: {
        label: t('toast.updateRestartNow'),
        onClick: () => void relaunch(),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Surface download errors as a sticky error toast (user must dismiss).
  useEffect(() => {
    if (state !== 'error') return;
    if (surfacedErrorRef.current) return;
    surfacedErrorRef.current = true;
    toast.error({ title: t('toast.updateError') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Progress is captured for potential future status-bar display; the toast
  // system doesn't support in-place updates so we don't spam per-tick toasts.
  useEffect(() => {
    // no-op: progress kept in state for future use
  }, [progress]);
  return null;
};
