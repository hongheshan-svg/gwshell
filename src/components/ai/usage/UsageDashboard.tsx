import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { BarChart3, ListFilter, Activity, RefreshCw, Coins, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { UsageSummaryCards } from "./UsageSummaryCards";
import { UsageTrendChart } from "./UsageTrendChart";
import { ProviderStatsTable, ModelStatsTable } from "./StatsTable";
import { PricingPanel } from "./PricingPanel";
import { fmtUsd, parseFiniteNumber } from "./format";
import type { UsageSummaryDto, TimeRange } from "./types";

const REFRESH_OPTIONS_MS = [0, 5000, 10000, 30000, 60000] as const;

export function UsageDashboard() {
  const { t } = useTranslation("ai");
  const [timeRange, setTimeRange] = useState<TimeRange>("1d");
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(30000);
  const [summary, setSummary] = useState<UsageSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const days =
    timeRange === "1d" ? 1 : timeRange === "7d" ? 7 : 30;

  const load = useCallback(async () => {
    try {
      const data = await invoke<UsageSummaryDto>(
        "ai_platform_get_usage_summary",
        { days },
      );
      setSummary(data);
    } catch (err) {
      console.error("[UsageDashboard] load failed", err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  // Initial load + reload when days changes
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Auto-refresh
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (refreshIntervalMs > 0) {
      intervalRef.current = setInterval(load, refreshIntervalMs);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshIntervalMs, load]);

  const changeRefreshInterval = () => {
    const currentIdx = REFRESH_OPTIONS_MS.indexOf(
      refreshIntervalMs as (typeof REFRESH_OPTIONS_MS)[number],
    );
    const safeIdx = currentIdx >= 0 ? currentIdx : 3;
    const nextIdx = (safeIdx + 1) % REFRESH_OPTIONS_MS.length;
    setRefreshIntervalMs(REFRESH_OPTIONS_MS[nextIdx]);
  };

  const handleClearUsage = async () => {
    try {
      await invoke("ai_platform_clear_usage_records");
      setSummary(null);
      setLoading(true);
      await load();
      toast.success(
        t("usage.clearSuccess", { defaultValue: "使用记录已清除" }),
        { closeButton: true },
      );
    } catch (err) {
      toast.error(String(err));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6 pb-8 px-6 pt-4 overflow-y-auto flex-1"
    >
      {/* Header + time range tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold">
            {t("usage.title", { defaultValue: "Usage 仪表盘" })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("usage.subtitle", { defaultValue: "AI 调用统计与成本追踪" })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 px-2 text-xs text-muted-foreground gap-1"
            title={t("common.refresh", { defaultValue: "刷新" })}
            onClick={changeRefreshInterval}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {refreshIntervalMs > 0
              ? `${refreshIntervalMs / 1000}s`
              : t("usage.noRefresh", { defaultValue: "手动" })}
          </Button>

          <Tabs
            value={timeRange}
            onValueChange={(v) => setTimeRange(v as TimeRange)}
          >
            <TabsList className="h-9">
              <TabsTrigger value="1d">
                {t("usage.today", { defaultValue: "今日" })}
              </TabsTrigger>
              <TabsTrigger value="7d">
                {t("usage.last7days", { defaultValue: "7 天" })}
              </TabsTrigger>
              <TabsTrigger value="30d">
                {t("usage.last30days", { defaultValue: "30 天" })}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Quick summary bar */}
      {summary && (
        <div className="rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm px-4 py-3 flex items-center gap-6 text-sm text-muted-foreground">
          <span>
            <strong className="text-foreground">
              {summary.totalRequests.toLocaleString()}
            </strong>{" "}
            {t("usage.requestsLabel", { defaultValue: "次请求" })}
          </span>
          <span className="text-border">|</span>
          <span>
            <strong className="text-foreground">
              {fmtUsd(parseFiniteNumber(summary.totalCost) ?? 0, 4)}
            </strong>{" "}
            {t("usage.costLabel", { defaultValue: "总费用" })}
          </span>
          <span className="text-border">|</span>
          <span>
            <strong className="text-foreground">
              {summary.totalTokens.toLocaleString()}
            </strong>{" "}
            tokens
          </span>
          <div className="ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-destructive"
              onClick={handleClearUsage}
            >
              {t("usage.clearAll", { defaultValue: "清除记录" })}
            </Button>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <UsageSummaryCards summary={summary} loading={loading} />

      {/* Trend chart */}
      <UsageTrendChart
        trend={summary?.dailyTrend ?? []}
        loading={loading}
        days={days}
      />

      {/* Stats tables */}
      <div className="space-y-4">
        <Tabs defaultValue="providers" className="w-full">
          <div className="flex items-center justify-between mb-3">
            <TabsList className="bg-muted/50">
              <TabsTrigger value="providers" className="gap-2 text-sm">
                <Activity className="h-3.5 w-3.5" />
                {t("usage.providerStats", { defaultValue: "供应商统计" })}
              </TabsTrigger>
              <TabsTrigger value="models" className="gap-2 text-sm">
                <BarChart3 className="h-3.5 w-3.5" />
                {t("usage.modelStats", { defaultValue: "模型统计" })}
              </TabsTrigger>
              <TabsTrigger value="logs" className="gap-2 text-sm">
                <ListFilter className="h-3.5 w-3.5" />
                {t("usage.requestLogs", { defaultValue: "请求日志" })}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="providers" className="mt-0">
            <ProviderStatsTable stats={summary?.byProvider ?? []} />
          </TabsContent>

          <TabsContent value="models" className="mt-0">
            <ModelStatsTable stats={summary?.byModel ?? []} />
          </TabsContent>

          <TabsContent value="logs" className="mt-0">
            <div className="rounded-lg border border-border/50 bg-card/40 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                {t("usage.logsNotAvailable", {
                  defaultValue:
                    "详细请求日志暂不支持，请通过供应商面板查看统计摘要",
                })}
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Pricing config */}
      <Accordion type="multiple" defaultValue={[]} className="w-full space-y-4">
        <AccordionItem
          value="pricing"
          className="rounded-xl border border-border/50 bg-card/40 overflow-hidden"
        >
          <AccordionTrigger className="px-5 py-3.5 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
            <div className="flex items-center gap-3">
              <Coins className="h-4 w-4 text-yellow-500" />
              <div className="text-left">
                <h3 className="text-sm font-semibold">
                  {t("usage.pricing.title", { defaultValue: "自定义定价" })}
                </h3>
                <p className="text-xs text-muted-foreground font-normal mt-0.5">
                  {t("usage.pricing.description", {
                    defaultValue: "配置模型的每百万 token 单价",
                  })}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-5 pb-5 pt-3 border-t border-border/50">
            <PricingPanel initialPricing={summary?.customPricing} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </motion.div>
  );
}
