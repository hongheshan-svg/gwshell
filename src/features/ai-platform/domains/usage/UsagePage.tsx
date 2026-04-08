import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { clearAiPlatformUsageRecords } from '../../infra/commands/usage';
import { useAiPlatformUsage } from '../../infra/query/useAiPlatformUsage';

function formatCurrency(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatTokens(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(value);
}

export function UsagePage() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(30);
  const [message, setMessage] = useState<string | null>(null);
  const { data, isLoading, error } = useAiPlatformUsage(days);

  const clearMutation = useMutation({
    mutationFn: clearAiPlatformUsageRecords,
    onSuccess: async () => {
      setMessage('Usage records 已清空。');
      await queryClient.invalidateQueries({ queryKey: ['ai-platform', 'usage'] });
    },
  });

  const trendMax = useMemo(
    () => Math.max(...(data?.dailyTrend ?? []).map((item) => item.cost), 0.001),
    [data?.dailyTrend],
  );

  return (
    <div className="ai-grid ai-gap-6">
      <section className="ai-grid ai-gap-4">
        <div className="ai-section-header">
          <div className="ai-grid ai-gap-2">
            <span className="ai-text-xs ai-uppercase ai-tracking-[0.18em] ai-text-muted-foreground">
              Domain / Usage
            </span>
            <div className="ai-grid ai-gap-2">
              <h2 className="ai-text-2xl ai-font-semibold ai-text-card-foreground">Usage Console</h2>
              <p className="ai-text-sm ai-text-muted-foreground ai-max-w-2xl">
                汇总 provider、model 和每日趋势数据，并从 legacy usage store 自动导入到新的 ai_platform 视图。
              </p>
            </div>
          </div>
          <div className="ai-flex ai-wrap ai-gap-3">
            {[7, 30, 90].map((value) => (
              <button
                className={`ai-button ${days === value ? 'ai-button-primary' : 'ai-button-secondary'}`}
                key={value}
                onClick={() => setDays(value)}
                type="button"
              >
                {value}d
              </button>
            ))}
            <button
              className="ai-button ai-button-danger"
              disabled={clearMutation.isPending || !data?.totalRequests}
              onClick={() => clearMutation.mutate()}
              type="button"
            >
              {clearMutation.isPending ? 'Clearing...' : 'Clear Records'}
            </button>
          </div>
        </div>

        <div className="ai-stats-grid">
          <article className="ai-stat-card">
            <span className="ai-stat-label">Total Cost</span>
            <span className="ai-stat-value">{formatCurrency(data?.totalCost ?? 0)}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Total Tokens</span>
            <span className="ai-stat-value">{formatTokens(data?.totalTokens ?? 0)}</span>
          </article>
          <article className="ai-stat-card">
            <span className="ai-stat-label">Requests</span>
            <span className="ai-stat-value">{data?.totalRequests ?? 0}</span>
          </article>
        </div>

        {message ? <div className="ai-inline-message">{message}</div> : null}
        {error ? <div className="ai-inline-message ai-inline-message-error">{String(error)}</div> : null}
      </section>

      {isLoading ? <div className="ai-inline-message">正在汇总 Usage 数据...</div> : null}

      {!isLoading && data ? (
        <>
          <section className="ai-grid ai-gap-4">
            <div className="ai-detail-header">
              <div className="ai-grid ai-gap-1">
                <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">Daily Trend</h3>
                <span className="ai-text-sm ai-text-muted-foreground">Source: {data.source}</span>
              </div>
            </div>

            {data.dailyTrend.length > 0 ? (
              <div className="ai-usage-chart-card">
                <div className="ai-usage-chart">
                  {data.dailyTrend.slice(-14).map((item) => (
                    <div className="ai-usage-bar-col" key={item.date} title={`${item.date} · ${formatCurrency(item.cost)}`}>
                      <div
                        className="ai-usage-bar"
                        style={{ height: `${Math.max((item.cost / trendMax) * 100, 4)}%` }}
                      />
                      <span className="ai-usage-bar-label">{item.date.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <article className="ai-provider-card ai-grid ai-gap-2">
                <h3 className="ai-text-lg ai-font-semibold ai-text-card-foreground">No usage data</h3>
                <p className="ai-text-sm ai-text-muted-foreground">当前时间窗口内还没有任何 usage records。</p>
              </article>
            )}
          </section>

          <section className="ai-provider-workbench">
            <div className="ai-grid ai-gap-4">
              <div className="ai-usage-table-card">
                <div className="ai-history-header">
                  <div className="ai-grid ai-gap-1">
                    <h4 className="ai-text-base ai-font-semibold ai-text-card-foreground">By Provider</h4>
                    <span className="ai-text-sm ai-text-muted-foreground">成本和请求量最高的 provider。</span>
                  </div>
                </div>
                <div className="ai-usage-table-wrap">
                  <table className="ai-usage-table">
                    <thead>
                      <tr>
                        <th>Provider</th>
                        <th>Cost</th>
                        <th>Tokens</th>
                        <th>Requests</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byProvider.map((item) => (
                        <tr key={item.provider}>
                          <td>{item.provider}</td>
                          <td>{formatCurrency(item.cost)}</td>
                          <td>{formatTokens(item.tokens)}</td>
                          <td>{item.requests}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <aside className="ai-provider-detail-card ai-grid ai-gap-4">
              <div className="ai-usage-table-card">
                <div className="ai-history-header">
                  <div className="ai-grid ai-gap-1">
                    <h4 className="ai-text-base ai-font-semibold ai-text-card-foreground">By Model</h4>
                    <span className="ai-text-sm ai-text-muted-foreground">模型级的成本与令牌汇总。</span>
                  </div>
                </div>
                <div className="ai-usage-table-wrap">
                  <table className="ai-usage-table">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>Cost</th>
                        <th>Tokens</th>
                        <th>Requests</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byModel.map((item) => (
                        <tr key={item.model}>
                          <td>{item.model}</td>
                          <td>{formatCurrency(item.cost)}</td>
                          <td>{formatTokens(item.tokens)}</td>
                          <td>{item.requests}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="ai-grid ai-gap-3">
                <div className="ai-history-header">
                  <div className="ai-grid ai-gap-1">
                    <h4 className="ai-text-base ai-font-semibold ai-text-card-foreground">Custom Pricing</h4>
                    <span className="ai-text-sm ai-text-muted-foreground">当前只展示已导入的模型计费配置。</span>
                  </div>
                </div>
                {(data.customPricing.length > 0 ? data.customPricing : []).map((pricing) => (
                  <div className="ai-detail-item" key={pricing.model}>
                    <strong className="ai-text-card-foreground">{pricing.model}</strong>
                    <span className="ai-detail-value">
                      Input {pricing.inputPricePerMillion}/M · Output {pricing.outputPricePerMillion}/M {pricing.currency}
                    </span>
                  </div>
                ))}
                {data.customPricing.length === 0 ? (
                  <div className="ai-detail-note">No custom pricing configured yet.</div>
                ) : null}
              </div>
            </aside>
          </section>
        </>
      ) : null}
    </div>
  );
}