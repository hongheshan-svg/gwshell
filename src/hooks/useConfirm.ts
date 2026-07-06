import { useConfirmStore, type ConfirmOptions } from '../stores/confirmStore';

export function useConfirm() {
  const request = useConfirmStore((s) => s.request);
  return (opts: ConfirmOptions) => request(opts);
}
