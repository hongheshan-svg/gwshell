import type { CustomEndpoint, ProviderMeta } from "../lib/types";

/**
 * 合并供应商元数据中的自定义端点。
 */
export function mergeProviderMeta(
  initialMeta: ProviderMeta | undefined,
  customEndpoints: Record<string, CustomEndpoint> | null | undefined,
): ProviderMeta | undefined {
  const hasCustomEndpoints =
    !!customEndpoints && Object.keys(customEndpoints).length > 0;

  const isExplicitClear =
    customEndpoints !== null &&
    customEndpoints !== undefined &&
    Object.keys(customEndpoints).length === 0;

  if (hasCustomEndpoints) {
    return {
      ...(initialMeta ? { ...initialMeta } : {}),
      custom_endpoints: customEndpoints!,
    };
  }

  if (isExplicitClear) {
    if (!initialMeta) {
      return undefined;
    }

    if ("custom_endpoints" in initialMeta) {
      const { custom_endpoints, ...rest } = initialMeta;
      return Object.keys(rest).length > 0 ? rest : {};
    }

    return { ...initialMeta };
  }

  if (!initialMeta) {
    return undefined;
  }

  if ("custom_endpoints" in initialMeta) {
    const { custom_endpoints, ...rest } = initialMeta;
    return Object.keys(rest).length > 0 ? rest : undefined;
  }

  return { ...initialMeta };
}
