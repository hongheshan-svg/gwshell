import React, { useEffect } from 'react';
import { useUpdaterStore } from '../../stores/updaterStore';
import { isTauriRuntime } from '../../lib/platform';
import { UpdateModal } from './UpdateModal';

/**
 * Schedules a single non-intrusive background update check after startup and
 * mounts the shared UpdateModal (triggered from toast, AppMenu, StatusBar, or ⌘K).
 */
export const UpdateChecker: React.FC = () => {
  const initCurrentVersion = useUpdaterStore((s) => s.initCurrentVersion);
  const checkForUpdate = useUpdaterStore((s) => s.checkForUpdate);

  useEffect(() => {
    void initCurrentVersion();
  }, [initCurrentVersion]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let idleCallbackId: number | null = null;

    const timer = window.setTimeout(() => {
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        idleCallbackId = window.requestIdleCallback(
          () => {
            void checkForUpdate({ manual: false });
          },
          { timeout: 5000 },
        );
      } else {
        idleCallbackId = setTimeout(() => {
          void checkForUpdate({ manual: false });
        }, 0);
      }
    }, 15000);

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
  }, [checkForUpdate]);

  return <UpdateModal />;
};
