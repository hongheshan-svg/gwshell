// src/lib/terminalLinks.ts
// Activation handler for links detected in terminal output (WebLinksAddon).
//
// The addon's default handler calls `window.open(uri)`, which on WebView2 opens
// an in-app popup navigated to an arbitrary remote page chosen by whatever the
// remote host printed. Instead: only http(s), always confirm with the user
// (showing the full URL), then hand it to the OS browser via the backend.

import { invoke } from '@tauri-apps/api/core';
import i18n from '../i18n';
import { useConfirmStore } from '../stores/confirmStore';
import { useToastStore } from '../stores/toastStore';

export function isOpenableTerminalUrl(uri: string): boolean {
  try {
    const url = new URL(uri);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname;
  } catch {
    return false;
  }
}

export function handleTerminalLinkActivate(event: MouseEvent, uri: string): void {
  event.preventDefault();
  if (!isOpenableTerminalUrl(uri)) return;
  const t = i18n.getFixedT(null, 'gwshell');
  void useConfirmStore
    .getState()
    .request({
      title: t('term_open_link_title'),
      message: uri,
      confirmLabel: t('term_open_link_confirm'),
    })
    .then((ok) => {
      if (!ok) return;
      return invoke('open_external_url', { url: uri });
    })
    .catch((err: unknown) => {
      useToastStore.getState().pushToast({
        kind: 'error',
        title: t('term_open_link_title'),
        message: String(err),
      });
    });
}
