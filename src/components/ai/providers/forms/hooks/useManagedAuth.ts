/**
 * useManagedAuth - GWShell stub
 *
 * CC Switch implements managed OAuth authentication (GitHub Copilot, etc.)
 * via a VSCode extension backend. This feature is not available in GWShell.
 *
 * This stub provides the same interface so ProviderForm.tsx compiles,
 * but all operations return "not authenticated" / "not supported" state.
 */

export type ManagedAuthProvider = "github_copilot" | "codex_oauth" | string;

export interface DeviceCode {
  user_code: string;
  device_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubAccount {
  id: string;
  login: string;
  name?: string;
  email?: string;
}

export interface ManagedAuthStatus {
  provider: ManagedAuthProvider;
  authenticated: boolean;
  default_account_id: string | null;
  accounts: GitHubAccount[];
  migration_error?: string | null;
}

export function useManagedAuth(authProvider: ManagedAuthProvider) {
  const accounts: GitHubAccount[] = [];

  return {
    authStatus: undefined as ManagedAuthStatus | undefined,
    isLoadingStatus: false,
    accounts,
    hasAnyAccount: false,
    isAuthenticated: false,
    defaultAccountId: null as string | null,
    migrationError: null as string | null,
    pollingState: "idle" as "idle" | "polling" | "success" | "error",
    deviceCode: null as DeviceCode | null,
    error: null as string | null,
    isPolling: false,
    isAddingAccount: false,
    isRemovingAccount: false,
    isSettingDefaultAccount: false,
    startAuth: () => {
      console.warn(
        `[GWShell] useManagedAuth: managed auth not supported for ${authProvider}`,
      );
    },
    addAccount: () => {
      console.warn(
        `[GWShell] useManagedAuth: managed auth not supported for ${authProvider}`,
      );
    },
    cancelAuth: () => {},
    logout: () => {
      console.warn(
        `[GWShell] useManagedAuth: managed auth not supported for ${authProvider}`,
      );
    },
    removeAccount: (_accountId: string) => {
      console.warn(
        `[GWShell] useManagedAuth: managed auth not supported for ${authProvider}`,
      );
    },
    setDefaultAccount: (_accountId: string) => {
      console.warn(
        `[GWShell] useManagedAuth: managed auth not supported for ${authProvider}`,
      );
    },
    refetchStatus: async () => {},
  };
}
