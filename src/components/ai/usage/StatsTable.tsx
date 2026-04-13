import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { fmtUsd } from "./format";
import type { ProviderUsage, ModelUsage } from "./types";

interface ProviderStatsTableProps {
  stats: ProviderUsage[];
}

export function ProviderStatsTable({ stats }: ProviderStatsTableProps) {
  const { t } = useTranslation("ai");
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 backdrop-blur-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              {t("usage.provider", { defaultValue: "供应商" })}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.requests", { defaultValue: "请求数" })}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.tokens", { defaultValue: "Tokens" })}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.cost", { defaultValue: "成本" })}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="text-center text-muted-foreground py-8"
              >
                {t("usage.noData", { defaultValue: "暂无数据" })}
              </TableCell>
            </TableRow>
          ) : (
            stats.map((stat) => (
              <TableRow key={stat.provider}>
                <TableCell className="font-medium">{stat.provider}</TableCell>
                <TableCell className="text-right">
                  {stat.requests.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {stat.tokens.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {fmtUsd(stat.cost, 4)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

interface ModelStatsTableProps {
  stats: ModelUsage[];
}

export function ModelStatsTable({ stats }: ModelStatsTableProps) {
  const { t } = useTranslation("ai");
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 backdrop-blur-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("usage.model", { defaultValue: "模型" })}</TableHead>
            <TableHead className="text-right">
              {t("usage.requests", { defaultValue: "请求数" })}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.tokens", { defaultValue: "Tokens" })}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.totalCost", { defaultValue: "总成本" })}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="text-center text-muted-foreground py-8"
              >
                {t("usage.noData", { defaultValue: "暂无数据" })}
              </TableCell>
            </TableRow>
          ) : (
            stats.map((stat) => (
              <TableRow key={stat.model}>
                <TableCell className="font-mono text-sm">
                  {stat.model}
                </TableCell>
                <TableCell className="text-right">
                  {stat.requests.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {stat.tokens.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {fmtUsd(stat.cost, 4)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
