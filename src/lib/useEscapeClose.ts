import { useEffect, useRef } from 'react';

/**
 * Closes an overlay (modal, dropdown, popover) when the user presses Escape.
 *
 * Uses a document-level keydown listener so it works regardless of which child
 * currently has focus, and a ref for the callback so the listener is registered
 * once (not re-subscribed on every render). Intended to give every dismissible
 * overlay consistent Escape behaviour to match its click-away backdrop.
 */
export function useEscapeClose(onClose: () => void): void {
  const cb = useRef(onClose);
  cb.current = onClose;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cb.current();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
