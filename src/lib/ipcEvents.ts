// Typed wrappers around window event dispatch + listen, so callers
// don't need `as CustomEvent` casts. This is the single sanctioned cast site
// for CustomEvent detail extraction.

export interface DockerPickPayload {
  tabId: string;
  id: string;
}

export interface DockerCancelPayload {
  tabId: string;
}

/**
 * Dispatch a typed CustomEvent on window.
 */
export function dispatchTypedEvent<T>(name: string, detail: T): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Listen for a typed CustomEvent on window. Returns an unsubscribe function.
 *
 * This is the single sanctioned `as CustomEvent` cast site — all other
 * TSAsExpression uses are banned by the no-restricted-syntax rule.
 */
export function listenTypedEvent<T>(name: string, handler: (detail: T) => void): () => void {
  // eslint-disable-next-line no-restricted-syntax
  const wrapped = (e: Event) => handler((e as CustomEvent<T>).detail);
  window.addEventListener(name, wrapped);
  return () => window.removeEventListener(name, wrapped);
}
