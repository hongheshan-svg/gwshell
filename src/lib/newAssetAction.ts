import { useAppStore } from '../stores/appStore';

const SSH_MODAL_TYPES = new Set(['ssh', 'ssh-tunnel']);

/** Route a `NewAssetMenu` selection to the corresponding creation modal. */
export function openNewAssetModal(type: string): void {
  const store = useAppStore.getState();
  if (type === 'quickconnect') {
    store.setShowQuickConnect(true);
  } else if (SSH_MODAL_TYPES.has(type)) {
    store.setShowNewSession(true);
  } else if (type === 'serial') {
    store.setShowSerialModal(true);
  } else if (type === 'docker') {
    store.setShowDockerModal(true);
  } else if (type === 'localshell') {
    store.setShowLocalTerminalModal(true);
  }
}
