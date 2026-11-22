import { create } from 'zustand';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import i18n from '../i18n';
import { isTauriRuntime } from '../lib/platform';
import {
  clearDismissedVersion,
  computeDownloadProgress,
  getDismissedVersion,
  normalizeUpdateError,
  setDismissedVersion,
} from '../lib/updaterUtils';
import { useToastStore } from './toastStore';

export type UpdaterStatus =
  'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdaterState {
  status: UpdaterStatus;
  currentVersion: string;
  availableVersion: string | null;
  releaseNotes: string;
  releaseDate: string;
  downloadedBytes: number;
  totalBytes: number;
  progress: number | null;
  errorMessage: string | null;
  modalOpen: boolean;
  lastCheckedAt: number | null;

  initCurrentVersion: () => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
  checkForUpdate: (opts?: { manual?: boolean }) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  installAndRelaunch: () => Promise<void>;
  skipAvailableVersion: () => void;
}

// Keep the native Tauri Update resource handle outside Zustand state (non-serializable)
// and always release previous handles via `.close()` to avoid leaking Rust ResourceIds.
let pendingUpdateHandle: Update | null = null;

async function releasePendingHandle(): Promise<void> {
  const prev = pendingUpdateHandle;
  pendingUpdateHandle = null;
  if (prev) {
    try {
      await prev.close();
    } catch {
      /* best-effort cleanup */
    }
  }
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: 'idle',
  currentVersion: '0.6.0',
  availableVersion: null,
  releaseNotes: '',
  releaseDate: '',
  downloadedBytes: 0,
  totalBytes: 0,
  progress: null,
  errorMessage: null,
  modalOpen: false,
  lastCheckedAt: null,

  initCurrentVersion: async () => {
    if (!isTauriRuntime()) return;
    try {
      const v = await getVersion();
      if (v) set({ currentVersion: v });
    } catch {
      /* keep fallback */
    }
  },

  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),

  checkForUpdate: async (opts) => {
    const manual = opts?.manual === true;
    const cur = get();

    // Prevent overlapping checks or clobbering an active download/ready install.
    if (cur.status === 'checking' || cur.status === 'downloading') {
      if (manual) set({ modalOpen: true });
      return;
    }
    if (cur.status === 'ready') {
      if (manual) set({ modalOpen: true });
      return;
    }

    if (!isTauriRuntime()) {
      if (manual) {
        set({
          status: 'up-to-date',
          errorMessage: null,
          lastCheckedAt: Date.now(),
          modalOpen: true,
        });
      }
      return;
    }

    set({
      status: 'checking',
      errorMessage: null,
      ...(manual ? { modalOpen: true } : {}),
    });

    try {
      const update = await check();
      const now = Date.now();

      if (!update) {
        await releasePendingHandle();
        set({
          status: 'up-to-date',
          availableVersion: null,
          releaseNotes: '',
          releaseDate: '',
          lastCheckedAt: now,
        });
        return;
      }

      await releasePendingHandle();
      pendingUpdateHandle = update;

      const dismissed = getDismissedVersion();
      const wasDismissed = dismissed === update.version;
      if (manual && wasDismissed) {
        clearDismissedVersion();
      }

      set({
        status: 'available',
        currentVersion: update.currentVersion || get().currentVersion,
        availableVersion: update.version,
        releaseNotes: update.body?.trim() ?? '',
        releaseDate: update.date ?? '',
        downloadedBytes: 0,
        totalBytes: 0,
        progress: null,
        errorMessage: null,
        lastCheckedAt: now,
        ...(manual ? { modalOpen: true } : {}),
      });

      // Silent background check: respect previously skipped version; otherwise show
      // a sticky toast (durationMs: 0) that opens the full release-notes modal.
      if (!manual && !wasDismissed) {
        const t = i18n.t.bind(i18n);
        useToastStore.getState().pushToast({
          kind: 'info',
          title: t('toast.updateAvailable'),
          message: t('toast.updateAvailableBody', { version: update.version }),
          durationMs: 0,
          action: {
            label: t('update_view_details'),
            onClick: () => set({ modalOpen: true }),
          },
        });
      }
    } catch (err) {
      const msg = normalizeUpdateError(err);
      if (manual) {
        set({
          status: 'error',
          errorMessage: msg,
          lastCheckedAt: Date.now(),
          modalOpen: true,
        });
      } else {
        // Silent background checks should not alarm users with sticky red toasts
        // when offline or behind a corporate firewall.
        console.warn('[updater] background check skipped:', msg);
        set({ status: 'idle', errorMessage: null, lastCheckedAt: Date.now() });
      }
    }
  },

  downloadAndInstall: async () => {
    const cur = get();
    if (cur.status === 'downloading' || cur.status === 'ready') return;

    const update = pendingUpdateHandle;
    if (!update) {
      await get().checkForUpdate({ manual: true });
      return;
    }

    set({
      status: 'downloading',
      downloadedBytes: 0,
      totalBytes: 0,
      progress: 0,
      errorMessage: null,
    });

    try {
      let totalBytes = 0;
      let downloadedBytes = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength ?? 0;
          set({
            totalBytes,
            downloadedBytes: 0,
            progress: computeDownloadProgress(0, totalBytes),
          });
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          set({
            downloadedBytes,
            totalBytes,
            progress: computeDownloadProgress(downloadedBytes, totalBytes),
          });
        } else if (event.event === 'Finished') {
          set({
            downloadedBytes: totalBytes || downloadedBytes,
            progress: 100,
          });
        }
      });

      set({ status: 'ready', progress: 100, errorMessage: null });

      // Always surface a sticky toast if the user minimized the modal while downloading.
      if (!get().modalOpen) {
        const t = i18n.t.bind(i18n);
        useToastStore.getState().pushToast({
          kind: 'success',
          title: t('toast.updateRestart'),
          durationMs: 0,
          action: {
            label: t('toast.updateRestartNow'),
            onClick: () => void get().installAndRelaunch(),
          },
        });
      }
    } catch (err) {
      const msg = normalizeUpdateError(err);
      set({ status: 'error', errorMessage: msg });
      if (!get().modalOpen) {
        const t = i18n.t.bind(i18n);
        useToastStore.getState().pushToast({
          kind: 'error',
          title: t('update_download_failed'),
          message: msg,
          durationMs: 0,
          action: {
            label: t('update_retry'),
            onClick: () => {
              set({ modalOpen: true });
              void get().downloadAndInstall();
            },
          },
        });
      }
    }
  },

  installAndRelaunch: async () => {
    try {
      await releasePendingHandle();
      await relaunch();
    } catch (err) {
      const msg = normalizeUpdateError(err);
      set({ status: 'error', errorMessage: msg, modalOpen: true });
    }
  },

  skipAvailableVersion: () => {
    const version = get().availableVersion;
    if (version) {
      setDismissedVersion(version);
    }
    set({ modalOpen: false });
  },
}));
