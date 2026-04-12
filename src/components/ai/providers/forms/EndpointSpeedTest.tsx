import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Zap, Loader2, Plus, X, AlertCircle, Save } from "lucide-react";
import type { AppId } from "../../lib/api";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { FullScreenPanel } from "../../common/FullScreenPanel";
import type { EndpointCandidate } from "../../lib/types";

// Endpoint speed-test timeout configuration (ms)
const ENDPOINT_TIMEOUT_MS: Record<AppId, number> = {
  codex: 12000,
  claude: 8000,
  gemini: 8000,
  opencode: 8000,
  openclaw: 8000,
};

interface TestResult {
  url: string;
  latency: number | null;
  status?: number;
  error?: string | null;
}

interface EndpointSpeedTestProps {
  appId: AppId;
  providerId?: string;
  value: string;
  onChange: (url: string) => void;
  initialEndpoints: EndpointCandidate[];
  visible?: boolean;
  onClose: () => void;
  autoSelect: boolean;
  onAutoSelectChange: (checked: boolean) => void;
  onCustomEndpointsChange?: (urls: string[]) => void;
}

interface EndpointEntry extends EndpointCandidate {
  id: string;
  latency: number | null;
  status?: number;
  error?: string | null;
}

const randomId = () => `ep_${Math.random().toString(36).slice(2, 9)}`;

const normalizeEndpointUrl = (url: string): string =>
  url.trim().replace(/\/+$/, "");

const buildInitialEntries = (
  candidates: EndpointCandidate[],
  selected: string,
): EndpointEntry[] => {
  const map = new Map<string, EndpointEntry>();
  const addCandidate = (candidate: EndpointCandidate) => {
    const sanitized = candidate.url ? normalizeEndpointUrl(candidate.url) : "";
    if (!sanitized) return;
    if (map.has(sanitized)) return;

    map.set(sanitized, {
      id: candidate.id ?? randomId(),
      url: sanitized,
      isCustom: candidate.isCustom ?? false,
      latency: null,
      status: undefined,
      error: null,
    });
  };

  candidates.forEach(addCandidate);

  const selectedUrl = normalizeEndpointUrl(selected);
  if (selectedUrl && !map.has(selectedUrl)) {
    addCandidate({ url: selectedUrl, isCustom: true });
  }

  return Array.from(map.values());
};

/**
 * Test a single endpoint via fetch with a timeout.
 * Returns latency in ms or an error string.
 */
async function testEndpoint(
  url: string,
  timeoutMs: number,
): Promise<TestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latency = Math.round(performance.now() - start);
    return { url, latency, status: response.status, error: null };
  } catch (err) {
    clearTimeout(timer);
    const error =
      err instanceof Error && err.name === "AbortError"
        ? "timeout"
        : (err instanceof Error ? err.message : String(err));
    return { url, latency: null, status: undefined, error };
  }
}

const EndpointSpeedTest: React.FC<EndpointSpeedTestProps> = ({
  appId,
  providerId,
  value,
  onChange,
  initialEndpoints,
  visible = true,
  onClose,
  autoSelect,
  onAutoSelectChange,
  onCustomEndpointsChange,
}) => {
  const { t } = useTranslation('ai');
  const [entries, setEntries] = useState<EndpointEntry[]>(() =>
    buildInitialEntries(initialEndpoints, value),
  );
  const [customUrl, setCustomUrl] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const normalizedSelected = normalizeEndpointUrl(value);
  const hasEndpoints = entries.length > 0;

  // Pass custom endpoint changes up to parent (create mode)
  useEffect(() => {
    if (!onCustomEndpointsChange || providerId) return;
    try {
      const customUrls = Array.from(
        new Set(
          entries
            .filter((e) => e.isCustom)
            .map((e) => (e.url ? normalizeEndpointUrl(e.url) : ""))
            .filter(Boolean),
        ),
      );
      onCustomEndpointsChange(customUrls);
    } catch {
      // ignore
    }
  }, [entries, onCustomEndpointsChange, providerId]);

  const sortedEntries = useMemo(() => {
    return entries.slice().sort((a: TestResult, b: TestResult) => {
      const aLatency = a.latency ?? Number.POSITIVE_INFINITY;
      const bLatency = b.latency ?? Number.POSITIVE_INFINITY;
      if (aLatency === bLatency) {
        return a.url.localeCompare(b.url);
      }
      return aLatency - bLatency;
    });
  }, [entries]);

  const handleAddEndpoint = useCallback(async () => {
    const candidate = customUrl.trim();
    let errorMsg: string | null = null;

    if (!candidate) {
      errorMsg = t("endpointTest.enterValidUrl");
    }

    let parsed: URL | null = null;
    if (!errorMsg) {
      try {
        parsed = new URL(candidate);
      } catch {
        errorMsg = t("endpointTest.invalidUrlFormat");
      }
    }

    const allowedProtocols = ["http:", "https:"];
    if (!errorMsg && parsed && !allowedProtocols.includes(parsed.protocol)) {
      errorMsg = t("endpointTest.onlyHttps");
    }

    let sanitized = "";
    if (!errorMsg && parsed) {
      sanitized = normalizeEndpointUrl(parsed.toString());
      const isDuplicate = entries.some((entry) => entry.url === sanitized);
      if (isDuplicate) {
        errorMsg = t("endpointTest.urlExists");
      }
    }

    if (errorMsg) {
      setAddError(errorMsg);
      return;
    }

    setAddError(null);
    setLastError(null);

    setEntries((prev) => {
      if (prev.some((e) => e.url === sanitized)) return prev;
      return [
        ...prev,
        {
          id: randomId(),
          url: sanitized,
          isCustom: true,
          latency: null,
          status: undefined,
          error: null,
        },
      ];
    });

    if (!normalizedSelected) {
      onChange(sanitized);
    }

    setCustomUrl("");
  }, [customUrl, entries, normalizedSelected, onChange, t]);

  const handleRemoveEndpoint = useCallback(
    (entry: EndpointEntry) => {
      setLastError(null);
      setEntries((prev) => {
        const next = prev.filter((item) => item.id !== entry.id);
        if (entry.url === normalizedSelected) {
          const fallback = next[0];
          onChange(fallback ? fallback.url : "");
        }
        return next;
      });
    },
    [normalizedSelected, onChange],
  );

  const runSpeedTest = useCallback(async () => {
    const urls = entries.map((entry) => entry.url);
    if (urls.length === 0) {
      setLastError(t("endpointTest.pleaseAddEndpoint"));
      return;
    }

    setIsTesting(true);
    setLastError(null);

    setEntries((prev) =>
      prev.map((entry) => ({
        ...entry,
        latency: null,
        status: undefined,
        error: null,
      })),
    );

    try {
      const timeoutMs = ENDPOINT_TIMEOUT_MS[appId];
      const results = await Promise.all(
        urls.map((url) => testEndpoint(url, timeoutMs)),
      );

      const resultMap = new Map(
        results.map((item) => [normalizeEndpointUrl(item.url), item]),
      );

      setEntries((prev) =>
        prev.map((entry) => {
          const match = resultMap.get(entry.url);
          if (!match) {
            return {
              ...entry,
              latency: null,
              status: undefined,
              error: t("endpointTest.noResult"),
            };
          }
          return {
            ...entry,
            latency: match.latency,
            status: match.status,
            error: match.error ?? null,
          };
        }),
      );

      if (autoSelect) {
        const successful = results
          .filter((item) => typeof item.latency === "number" && item.latency !== null)
          .sort((a, b) => (a.latency! || 0) - (b.latency! || 0));
        const best = successful[0];
        if (best && best.url && best.url !== normalizedSelected) {
          onChange(best.url);
        }
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `${t("endpointTest.testFailed", { error: String(error) })}`;
      setLastError(message);
    } finally {
      setIsTesting(false);
    }
  }, [entries, autoSelect, appId, normalizedSelected, onChange, t]);

  const handleSelect = useCallback(
    (url: string) => {
      if (!url || url === normalizedSelected) return;
      onChange(url);
    },
    [normalizedSelected, onChange],
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    // In GWShell, custom endpoints are passed via onCustomEndpointsChange.
    // No separate backend save step needed.
    setIsSaving(false);
    onClose();
  }, [onClose]);

  if (!visible) return null;

  const footer = (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={(event) => {
          event.preventDefault();
          onClose();
        }}
        disabled={isSaving}
      >
        {t("common.cancel")}
      </Button>
      <Button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        className="gap-2"
      >
        {isSaving ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("common.saving")}
          </>
        ) : (
          <>
            <Save className="w-4 h-4" />
            {t("common.save")}
          </>
        )}
      </Button>
    </div>
  );

  return (
    <FullScreenPanel
      isOpen={visible}
      title={t("endpointTest.title")}
      onClose={onClose}
      footer={footer}
    >
      <div className="glass rounded-xl p-6 border border-white/10 flex flex-col gap-6">
        {/* Speed test control bar */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {entries.length} {t("endpointTest.endpoints")}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
              <input
                type="checkbox"
                checked={autoSelect}
                onChange={(event) => {
                  onAutoSelectChange(event.target.checked);
                }}
                className="h-3.5 w-3.5 rounded border-border-default bg-background text-primary focus:ring-2 focus:ring-primary/20"
              />
              {t("endpointTest.autoSelect")}
            </label>
            <Button
              type="button"
              onClick={runSpeedTest}
              disabled={isTesting || !hasEndpoints}
              size="sm"
              className="h-7 w-24 gap-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {isTesting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("endpointTest.testing")}
                </>
              ) : (
                <>
                  <Zap className="h-3.5 w-3.5" />
                  {t("endpointTest.testSpeed")}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Add endpoint input */}
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Input
              type="text"
              value={customUrl}
              placeholder={t("endpointTest.addEndpointPlaceholder")}
              onChange={(event) => setCustomUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddEndpoint();
                }
              }}
              className="flex-1"
            />
            <Button
              type="button"
              onClick={handleAddEndpoint}
              variant="outline"
              size="icon"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {addError && (
            <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-3 w-3" />
              {addError}
            </div>
          )}
        </div>

        {/* Endpoint list */}
        {hasEndpoints ? (
          <div className="space-y-2">
            {sortedEntries.map((entry) => {
              const isSelected = normalizedSelected === entry.url;
              const latency = entry.latency;

              return (
                <div
                  key={entry.id}
                  onClick={() => handleSelect(entry.url)}
                  className={`group flex cursor-pointer items-center justify-between px-3 py-2.5 rounded-lg border transition text-foreground ${
                    isSelected
                      ? "border-primary/70 bg-primary/5 shadow-sm"
                      : "border-border-default bg-background hover:bg-muted"
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div
                      className={`h-1.5 w-1.5 flex-shrink-0 rounded-full transition ${
                        isSelected
                          ? "bg-blue-500 dark:bg-blue-400"
                          : "bg-gray-300 dark:bg-gray-700"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-foreground">
                        {entry.url}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {latency !== null ? (
                      <div className="text-right">
                        <div
                          className={`font-mono text-sm font-medium ${
                            latency < 300
                              ? "text-emerald-600 dark:text-emerald-400"
                              : latency < 500
                                ? "text-yellow-600 dark:text-yellow-400"
                                : latency < 800
                                  ? "text-orange-600 dark:text-orange-400"
                                  : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {latency}ms
                        </div>
                      </div>
                    ) : isTesting ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : entry.error ? (
                      <div className="text-xs text-gray-400">
                        {t("endpointTest.failed")}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400">—</div>
                    )}

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRemoveEndpoint(entry);
                      }}
                      className="opacity-0 transition hover:text-red-600 group-hover:opacity-100 dark:hover:text-red-400"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border-default bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
            {t("endpointTest.empty")}
          </div>
        )}

        {lastError && (
          <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="h-3 w-3" />
            {lastError}
          </div>
        )}
      </div>
    </FullScreenPanel>
  );
};

export default EndpointSpeedTest;
