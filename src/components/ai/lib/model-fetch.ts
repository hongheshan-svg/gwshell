/**
 * Model fetch API adapter for GWShell.
 *
 * Uses a direct fetch to the /v1/models endpoint instead of the Tauri IPC
 * invoke("fetch_models_for_config") used in CC Switch.
 */

import { toast } from "sonner";

export interface FetchedModel {
  id: string;
  ownedBy: string | null;
}

/**
 * Fetch available models from a provider via OpenAI-compatible GET /v1/models.
 */
export async function fetchModelsForConfig(
  baseUrl: string,
  apiKey: string,
  _isFullUrl?: boolean,
): Promise<FetchedModel[]> {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const url = `${normalizedBase}/v1/models`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json = await response.json();
  const data: { id: string; owned_by?: string }[] = json?.data ?? [];

  return data.map((item) => ({
    id: item.id,
    ownedBy: item.owned_by ?? null,
  }));
}

/**
 * Show appropriate error toast based on error type.
 */
export function showFetchModelsError(
  err: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any,
  opts?: { hasApiKey: boolean; hasBaseUrl: boolean },
): void {
  if (opts && !opts.hasBaseUrl && !opts.hasApiKey) {
    toast.error(t("providerForm.fetchModelsNeedConfig"));
    return;
  }
  if (opts && !opts.hasApiKey) {
    toast.error(t("providerForm.fetchModelsNeedApiKey"));
    return;
  }
  if (opts && !opts.hasBaseUrl) {
    toast.error(t("providerForm.fetchModelsNeedEndpoint"));
    return;
  }

  const msg = String(err);

  if (msg.includes("HTTP 401") || msg.includes("HTTP 403")) {
    toast.error(t("providerForm.fetchModelsAuthFailed"));
    return;
  }
  if (msg.includes("HTTP 404") || msg.includes("HTTP 405")) {
    toast.error(t("providerForm.fetchModelsNotSupported"));
    return;
  }
  if (msg.includes("timeout") || msg.includes("TimeoutError")) {
    toast.error(t("providerForm.fetchModelsTimeout"));
    return;
  }

  toast.error(
    t("providerForm.fetchModelsFailed", { error: msg }),
  );
}
