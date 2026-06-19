// Platform detection shared across the app.
export const IS_MACOS = typeof navigator !== 'undefined'
  && /Mac OS X|Macintosh/.test(navigator.userAgent);

export const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
