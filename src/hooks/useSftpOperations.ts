import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useConfirm } from './useConfirm';
import type { SftpEntry, SftpProgress } from '../lib/sftpUtils';

interface UseSftpOperationsOptions {
  sessionId: string;
  currentPath: string;
  loadDir: (path: string) => Promise<void>;
  setError: (err: string | null) => void;
}

export function useSftpOperations({
  sessionId,
  currentPath,
  loadDir,
  setError,
}: UseSftpOperationsOptions) {
  const { t } = useTranslation();
  const confirm = useConfirm();

  const [renamingEntry, setRenamingEntry] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFileMode, setNewFileMode] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [chmodEntry, setChmodEntry] = useState<SftpEntry | null>(null);
  const [chmodValue, setChmodValue] = useState('');
  const [editingFile, setEditingFile] = useState<SftpEntry | null>(null);

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [progress, setProgress] = useState<SftpProgress | null>(null);
  const transferActiveRef = useRef(false);

  const runExclusive = useCallback(async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const runTransfer = useCallback(async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    transferActiveRef.current = true;
    try {
      await fn();
    } finally {
      transferActiveRef.current = false;
      busyRef.current = false;
      setBusy(false);
      setProgress(null);
    }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<SftpProgress>(`sftp-progress-${sessionId}`, (e) => {
      if (transferActiveRef.current) setProgress(e.payload);
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [sessionId]);

  const handleOpenLocal = useCallback(
    (entry: SftpEntry) =>
      runExclusive(async () => {
        const openRemote = (allowExecutable: boolean) =>
          invoke<string>('sftp_open_file', {
            sessionId,
            remotePath: entry.path,
            allowExecutable,
          });
        try {
          await openRemote(false);
        } catch (err) {
          const message = String(err);
          const marker = 'OPEN_EXECUTABLE_CONFIRM:';
          if (!message.includes(marker)) {
            setError(message);
            return;
          }
          const ext = message.slice(message.indexOf(marker) + marker.length).trim();
          const ok = await confirm({
            title: t('sftp_open_executable_title'),
            message: t('sftp_open_executable_body', { name: entry.name, ext }),
            confirmLabel: t('sftp_open_executable_confirm'),
            danger: true,
          });
          if (!ok) return;
          try {
            await openRemote(true);
          } catch (retryErr) {
            setError(String(retryErr));
          }
        }
      }),
    [confirm, runExclusive, sessionId, setError, t],
  );

  const handleDownload = useCallback(
    (entry: SftpEntry) =>
      runTransfer(async () => {
        try {
          if (entry.is_dir) {
            const dir = await open({ directory: true });
            if (typeof dir !== 'string' || !dir) return;
            await invoke('sftp_download_dir', {
              sessionId,
              remotePath: entry.path,
              localDir: dir,
            });
          } else {
            const localPath = await save({ defaultPath: entry.name });
            if (!localPath) return;
            await invoke('sftp_download', {
              sessionId,
              remotePath: entry.path,
              localPath,
            });
          }
        } catch (err) {
          setError(String(err));
        }
      }),
    [runTransfer, sessionId, setError],
  );

  const handleUploadLocalPaths = useCallback(
    (paths: string[]) =>
      runTransfer(async () => {
        if (!currentPath || paths.length === 0) return;
        try {
          for (const localPath of paths) {
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
            const fileName = localPath.replace(/\\/g, '/').split('/').pop() || 'file';
            const remotePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
            try {
              await invoke('sftp_upload', { sessionId, remotePath, localPath });
            } catch {
              // If the dropped path is a local directory, fall back to recursive dir upload.
              await invoke('sftp_upload_dir', {
                sessionId,
                remotePath: currentPath,
                localDir: localPath,
              });
            }
          }
          void loadDir(currentPath);
        } catch (err) {
          setError(String(err));
        }
      }),
    [currentPath, loadDir, runTransfer, sessionId, setError],
  );

  const handleUpload = useCallback(
    () =>
      runTransfer(async () => {
        try {
          const selected = await open({ multiple: true });
          if (!selected) return;
          const files = Array.isArray(selected) ? selected : [selected];
          for (const fileEntry of files) {
            const path =
              typeof fileEntry === 'string' ? fileEntry : (fileEntry as { path: string }).path; // eslint-disable-line no-restricted-syntax -- Tauri open() returns string|object union; narrowing to {path}
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
            const fileName = path.replace(/\\/g, '/').split('/').pop() || 'file';
            const remotePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
            await invoke('sftp_upload', { sessionId, remotePath, localPath: path });
          }
          void loadDir(currentPath);
        } catch (err) {
          setError(String(err));
        }
      }),
    [currentPath, loadDir, runTransfer, sessionId, setError],
  );

  const handleUploadFolder = useCallback(
    () =>
      runTransfer(async () => {
        try {
          const selected = await open({ directory: true });
          if (typeof selected !== 'string' || !selected) return;
          await invoke('sftp_upload_dir', {
            sessionId,
            remotePath: currentPath,
            localDir: selected,
          });
          void loadDir(currentPath);
        } catch (err) {
          setError(String(err));
        }
      }),
    [currentPath, loadDir, runTransfer, sessionId, setError],
  );

  const handleDelete = useCallback(
    async (entry: SftpEntry) => {
      const ok = await confirm({
        title: t('common_delete_confirm_title'),
        message: t('common_delete_confirm_body', { name: entry.name }),
        danger: true,
      });
      if (!ok) return;
      try {
        if (entry.is_dir) {
          await invoke('sftp_rmdir', { sessionId, path: entry.path });
        } else {
          await invoke('sftp_delete_file', { sessionId, path: entry.path });
        }
        void loadDir(currentPath);
      } catch (err) {
        setError(String(err));
      }
    },
    [confirm, currentPath, loadDir, sessionId, setError, t],
  );

  const handleRename = useCallback(
    async (entry: SftpEntry) => {
      if (!renameValue.trim() || renameValue === entry.name) {
        setRenamingEntry(null);
        return;
      }
      const parentDir = entry.path.replace(/\/[^/]+$/, '') || '/';
      const newPath = parentDir === '/' ? `/${renameValue}` : `${parentDir}/${renameValue}`;
      try {
        await invoke('sftp_rename', { sessionId, oldPath: entry.path, newPath });
        setRenamingEntry(null);
        void loadDir(currentPath);
      } catch (err) {
        setError(String(err));
      }
    },
    [currentPath, loadDir, renameValue, sessionId, setError],
  );

  const handleNewFolder = useCallback(async () => {
    if (!newFolderName.trim()) {
      setNewFolderMode(false);
      return;
    }
    const path =
      currentPath === '/' ? `/${newFolderName.trim()}` : `${currentPath}/${newFolderName.trim()}`;
    try {
      await invoke('sftp_mkdir', { sessionId, path });
      setNewFolderMode(false);
      setNewFolderName('');
      void loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  }, [currentPath, loadDir, newFolderName, sessionId, setError]);

  const handleNewFile = useCallback(async () => {
    if (!newFileName.trim()) {
      setNewFileMode(false);
      return;
    }
    const path =
      currentPath === '/' ? `/${newFileName.trim()}` : `${currentPath}/${newFileName.trim()}`;
    try {
      await invoke('sftp_create_file', { sessionId, path });
      setNewFileMode(false);
      setNewFileName('');
      void loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  }, [currentPath, loadDir, newFileName, sessionId, setError]);

  const handleCopyPath = useCallback((pathToCopy: string) => {
    navigator.clipboard.writeText(pathToCopy).catch(() => {});
  }, []);

  const handleChmod = useCallback(async () => {
    if (!chmodEntry || !chmodValue.trim()) {
      setChmodEntry(null);
      return;
    }
    const mode = parseInt(chmodValue, 8);
    if (isNaN(mode) || mode < 0 || mode > 0o7777) {
      setError(t('sftp_chmod_invalid'));
      setChmodEntry(null);
      return;
    }
    try {
      await invoke('sftp_chmod', { sessionId, path: chmodEntry.path, mode });
      setChmodEntry(null);
      setChmodValue('');
      void loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  }, [chmodEntry, chmodValue, currentPath, loadDir, sessionId, setError, t]);

  return {
    busy,
    progress,
    renamingEntry,
    setRenamingEntry,
    renameValue,
    setRenameValue,
    newFolderMode,
    setNewFolderMode,
    newFolderName,
    setNewFolderName,
    newFileMode,
    setNewFileMode,
    newFileName,
    setNewFileName,
    chmodEntry,
    setChmodEntry,
    chmodValue,
    setChmodValue,
    editingFile,
    setEditingFile,
    handleOpenLocal,
    handleDownload,
    handleUpload,
    handleUploadFolder,
    handleUploadLocalPaths,
    handleDelete,
    handleRename,
    handleNewFolder,
    handleNewFile,
    handleCopyPath,
    handleChmod,
  };
}
