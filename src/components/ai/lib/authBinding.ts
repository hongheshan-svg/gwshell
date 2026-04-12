import type { ProviderMeta } from "./types";

/**
 * Resolve the managed account ID for a given auth provider from ProviderMeta.
 * GWShell stub: mirrors CC Switch's resolveManagedAccountId from src/lib/authBinding.ts.
 * In GWShell, managed OAuth (e.g. GitHub Copilot) is not supported, so this always
 * returns null unless the meta already has a stored githubAccountId.
 */
export function resolveManagedAccountId(
  meta: ProviderMeta | undefined,
  authProvider: string,
): string | null {
  const binding = meta?.authBinding;

  if (
    binding?.source === "managed_account" &&
    binding.authProvider === authProvider
  ) {
    return binding.accountId ?? null;
  }

  if (authProvider === "github_copilot") {
    return meta?.githubAccountId ?? null;
  }

  return null;
}
