import React, { useState, useEffect } from 'react';
import { BarChart3, DollarSign, Zap, Trash2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { TranslationKeys } from '../../i18n';

interface UsageSummary {
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  byProvider: { provider: string; cost: number; tokens: number; requests: number }[];
  byModel: { model: string; cost: number; tokens: number; requests: number }[];
  dailyTrend: { date: string; cost: number; tokens: number; requests: number }[];
}

interface Props {
  t: (k: TranslationKeys) => string;
}

export const UsageDashboard: React.FC<Props> = ({ t }) => {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);

  const loadSummary = async () => {
    setLoading(true);
    try {
      const data = await invoke<UsageSummary>('get_usage_summary', { days });
      setSummary(data);
    } catch {
      // No data yet
      setSummary({ totalCost: 0, totalTokens: 0, totalRequests: 0, byProvider: [], byModel: [], dailyTrend: [] });
    }
    setLoading(false);
  };

  useEffect(() => { loadSummary(); }, [days]);

  const handleClear = async () => {
    try {
      await invoke('clear_usage_records');
      await loadSummary();
    } catch { /* empty */ }
  };

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const maxCost = summary ? Math.max(...summary.dailyTrend.map(d => d.cost), 0.01) : 1;

  return (
    <div className="usage-dashboard">
      <div className="usage-header">
        <h3>{t('usage_title')}</h3>
        <div className="usage-period-selector">
          {[7, 30, 90].map(d => (
            <button key={d}
              className={`usage-period-btn ${days === d ? 'active' : ''}`}
              onClick={() => setDays(d)}>
              {d}{t('usage_days')}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="usage-loading">{t('sftp_loading')}</div>
      ) : summary ? (
        <>
          {/* Summary cards */}
          <div className="usage-cards">
            <div className="usage-card">
              <DollarSign size={16} />
              <div className="usage-card-content">
                <span className="usage-card-value">${summary.totalCost.toFixed(4)}</span>
                <span className="usage-card-label">{t('usage_total_cost')}</span>
              </div>
            </div>
            <div className="usage-card">
              <Zap size={16} />
              <div className="usage-card-content">
                <span className="usage-card-value">{formatTokens(summary.totalTokens)}</span>
                <span className="usage-card-label">{t('usage_total_tokens')}</span>
              </div>
            </div>
            <div className="usage-card">
              <BarChart3 size={16} />
              <div className="usage-card-content">
                <span className="usage-card-value">{summary.totalRequests}</span>
                <span className="usage-card-label">{t('usage_total_requests')}</span>
              </div>
            </div>
          </div>

          {/* Daily trend chart (simple bar chart) */}
          {summary.dailyTrend.length > 0 && (
            <div className="usage-chart-section">
              <h4>{t('usage_daily_trend')}</h4>
              <div className="usage-bar-chart">
                {summary.dailyTrend.slice(-14).map(d => (
                  <div key={d.date} className="usage-bar-col" title={`${d.date}: $${d.cost.toFixed(4)}`}>
                    <div className="usage-bar"
                      style={{ height: `${Math.max((d.cost / maxCost) * 100, 2)}%` }} />
                    <span className="usage-bar-label">{d.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By provider */}
          {summary.byProvider.length > 0 && (
            <div className="usage-table-section">
              <h4>{t('usage_by_provider')}</h4>
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>{t('usage_total_cost')}</th>
                    <th>Tokens</th>
                    <th>{t('usage_total_requests')}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byProvider.map(p => (
                    <tr key={p.provider}>
                      <td>{p.provider}</td>
                      <td>${p.cost.toFixed(4)}</td>
                      <td>{formatTokens(p.tokens)}</td>
                      <td>{p.requests}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* By model */}
          {summary.byModel.length > 0 && (
            <div className="usage-table-section">
              <h4>{t('usage_by_model')}</h4>
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>{t('ai_model')}</th>
                    <th>{t('usage_total_cost')}</th>
                    <th>Tokens</th>
                    <th>{t('usage_total_requests')}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byModel.map(m => (
                    <tr key={m.model}>
                      <td>{m.model}</td>
                      <td>${m.cost.toFixed(4)}</td>
                      <td>{formatTokens(m.tokens)}</td>
                      <td>{m.requests}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Empty state */}
          {summary.totalRequests === 0 && (
            <div className="usage-empty">
              <BarChart3 size={48} strokeWidth={1} />
              <p>{t('usage_no_data')}</p>
              <p className="usage-empty-hint">{t('usage_no_data_desc')}</p>
            </div>
          )}

          {summary.totalRequests > 0 && (
            <div className="usage-footer">
              <button className="ai-toolbar-btn danger" onClick={handleClear}>
                <Trash2 size={13} /> {t('usage_clear')}
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};
