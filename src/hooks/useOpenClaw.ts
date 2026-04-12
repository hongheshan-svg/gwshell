/**
 * GWShell stub: useOpenClawLiveProviderIds
 *
 * In CC Switch, this hook queries live provider IDs from openclaw.json.
 * GWShell does not have an equivalent backend service (openclaw is configured
 * via static config files, not a running daemon). This stub always returns
 * an empty array so that "provider key locked" logic never triggers.
 */
export function useOpenClawLiveProviderIds(_enabled: boolean): {
  data: string[];
  isLoading: boolean;
} {
  return {
    data: [],
    isLoading: false,
  };
}
