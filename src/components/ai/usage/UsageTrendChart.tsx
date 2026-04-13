import { useTranslation } from "react-i18next";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Loader2 } from "lucide-react";
import { fmtUsd, getLocaleFromLanguage, parseFiniteNumber } from "./format";
import type { DailyUsage } from "./types";

interface Props {
  trend: DailyUsage[];
  loading: boolean;
  days: number;
}

export function UsageTrendChart({ trend, loading, days }: Props) {
  const { t, i18n } = useTranslation("ai");
  const language = i18n.resolvedLanguage || i18n.language || "en";
  const dateLocale = getLocaleFromLanguage(language);
  const isToday = days === 1;

  if (loading) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-xl bg-card/40 border border-border/50">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  const chartData = trend.map((stat) => {
    const pointDate = new Date(stat.date);
    const cost = parseFiniteNumber(stat.cost);
    return {
      label: isToday
        ? pointDate.toLocaleTimeString(dateLocale, {
            hour: "2-digit",
            minute: "2-digit",
          })
        : pointDate.toLocaleDateString(dateLocale, {
            month: "2-digit",
            day: "2-digit",
          }),
      tokens: stat.tokens,
      requests: stat.requests,
      cost: cost ?? 0,
    };
  });

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur-md">
          <p className="mb-2 font-medium text-sm">{label}</p>
          {payload.map((entry: any, index: number) => (
            <div
              key={index}
              className="flex items-center gap-2 text-xs"
              style={{ color: entry.color }}
            >
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="font-medium">{entry.name}:</span>
              <span>
                {entry.dataKey === "cost"
                  ? fmtUsd(entry.value, 6)
                  : entry.value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="rounded-xl border border-border/50 bg-card/40 p-6 backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold">
          {t("usage.trends", { defaultValue: "使用趋势" })}
        </h3>
        <p className="text-xs text-muted-foreground">
          {isToday
            ? t("usage.rangeToday", { defaultValue: "今天" })
            : days === 7
              ? t("usage.rangeLast7Days", { defaultValue: "过去 7 天" })
              : t("usage.rangeLast30Days", { defaultValue: "过去 30 天" })}
        </p>
      </div>

      {chartData.length === 0 ? (
        <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm">
          {t("usage.noData", { defaultValue: "暂无数据" })}
        </div>
      ) : (
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="hsl(var(--border))"
                opacity={0.4}
              />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                dy={8}
              />
              <YAxis
                yAxisId="tokens"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                tickFormatter={(v) =>
                  v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`
                }
              />
              <YAxis
                yAxisId="cost"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                tickFormatter={(v) => `$${v}`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              <Area
                yAxisId="tokens"
                type="monotone"
                dataKey="tokens"
                name={t("usage.totalTokens", { defaultValue: "Tokens" })}
                stroke="#3b82f6"
                fillOpacity={1}
                fill="url(#colorTokens)"
                strokeWidth={2}
              />
              <Area
                yAxisId="tokens"
                type="monotone"
                dataKey="requests"
                name={t("usage.totalRequests", { defaultValue: "请求数" })}
                stroke="#22c55e"
                fillOpacity={1}
                fill="url(#colorRequests)"
                strokeWidth={2}
              />
              <Area
                yAxisId="cost"
                type="monotone"
                dataKey="cost"
                name={t("usage.cost", { defaultValue: "成本" })}
                stroke="#f43f5e"
                fill="none"
                strokeWidth={2}
                strokeDasharray="4 4"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
