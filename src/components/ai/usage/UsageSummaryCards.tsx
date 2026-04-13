import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "../ui/card";
import { Activity, DollarSign, Layers, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { fmtUsd, parseFiniteNumber } from "./format";
import type { UsageSummaryDto } from "./types";

interface Props {
  summary: UsageSummaryDto | null;
  loading: boolean;
}

export function UsageSummaryCards({ summary, loading }: Props) {
  const { t } = useTranslation("ai");

  const stats = useMemo(() => {
    const totalRequests = summary?.totalRequests ?? 0;
    const totalCost = parseFiniteNumber(summary?.totalCost);
    const totalTokens = summary?.totalTokens ?? 0;

    return [
      {
        title: t("usage.totalRequests", { defaultValue: "总请求数" }),
        value: totalRequests.toLocaleString(),
        icon: Activity,
        color: "text-blue-500",
        bg: "bg-blue-500/10",
      },
      {
        title: t("usage.totalCost", { defaultValue: "总费用" }),
        value: totalCost == null ? "--" : fmtUsd(totalCost, 4),
        icon: DollarSign,
        color: "text-green-500",
        bg: "bg-green-500/10",
      },
      {
        title: t("usage.totalTokens", { defaultValue: "总 Tokens" }),
        value: totalTokens.toLocaleString(),
        icon: Layers,
        color: "text-purple-500",
        bg: "bg-purple-500/10",
      },
    ];
  }, [summary, t]);

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };
  const item = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <Card key={i} className="border border-border/50 bg-card/40">
            <CardContent className="p-6 flex items-center justify-center min-h-[120px]">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="grid gap-4 md:grid-cols-3"
    >
      {stats.map((stat, i) => (
        <motion.div key={i} variants={item}>
          <Card className="border border-border/50 bg-gradient-to-br from-card/50 to-background/50 backdrop-blur-xl hover:from-card/60 hover:to-background/60 transition-all shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <p className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </p>
                <div className={`p-2 rounded-lg ${stat.bg}`}>
                  <stat.icon className={`h-4 w-4 ${stat.color}`} />
                </div>
              </div>
              <h3 className="text-2xl font-bold truncate">{stat.value}</h3>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </motion.div>
  );
}
