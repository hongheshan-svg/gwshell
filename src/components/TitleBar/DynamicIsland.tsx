import React, { useEffect, useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Brain, Zap, Wifi, Activity, ChevronDown, DollarSign, MessageSquare } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import './DynamicIsland.css';

interface AiProvider {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  apps: { claude: boolean; codex: boolean; gemini: boolean; opencode: boolean; openclaw: boolean };
  models: {
    claude?: { model?: string; haikuModel?: string; sonnetModel?: string; opusModel?: string };
    codex?: { model?: string };
    gemini?: { model?: string };
    opencode?: { model?: string };
    openclaw?: { model?: string };
  };
  enabled: boolean;
  notes?: string;
}

interface UsageSummary {
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  byProvider: { provider: string; cost: number; tokens: number; requests: number }[];
  byModel: { model: string; cost: number; tokens: number; requests: number }[];
  dailyTrend: { date: string; cost: number; tokens: number; requests: number }[];
}

type ActiveIds = [
  string | null, // claude
  string | null, // codex
  string | null, // gemini
  string | null, // opencode
  string | null, // openclaw
];

const TOOL_NAMES = ['Claude', 'Codex', 'Gemini', 'OpenCode', 'OpenClaw'] as const;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0';
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

function shortenModel(model: string): string {
  // Shorten model names for display
  return model
    .replace('claude-', '')
    .replace('gpt-', '')
    .replace('gemini-', '')
    .replace(/-\d{8}$/, ''); // remove date suffixes like -20250514
}

export const DynamicIsland: React.FC = () => {
  const t = useAppStore((s) => s.t);
  const tabs = useAppStore((s) => s.tabs);
  const [expanded, setExpanded] = useState(false);
  const [activeProvider, setActiveProvider] = useState<AiProvider | null>(null);
  const [activeModel, setActiveModel] = useState<string>('');
  const [activeTool, setActiveTool] = useState<string>('');
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [allActiveInfo, setAllActiveInfo] = useState<{ tool: string; provider: string; model: string }[]>([]);
  const islandRef = useRef<HTMLDivElement>(null);

  const connectedCount = tabs.filter(tab => tab.connected && tab.type !== 'asset-list').length;

  const fetchData = useCallback(async () => {
    try {
      const [providers, activeIds, usageSummary] = await Promise.all([
        invoke<AiProvider[]>('list_ai_providers'),
        invoke<ActiveIds>('get_ai_active_ids'),
        invoke<UsageSummary>('get_usage_summary', { days: 1 }),
      ]);

      setUsage(usageSummary);

      // Build active info for all tools
      const infoList: { tool: string; provider: string; model: string }[] = [];
      const toolFields = ['claude', 'codex', 'gemini', 'opencode', 'openclaw'] as const;
      let primaryProvider: AiProvider | null = null;
      let primaryModel = '';
      let primaryTool = '';

      for (let i = 0; i < 5; i++) {
        const id = activeIds[i];
        if (!id) continue;
        const prov = providers.find(p => p.id === id);
        if (!prov) continue;

        const field = toolFields[i];
        const models = prov.models[field];
        const model = models && 'model' in models ? (models.model || '') : '';

        infoList.push({
          tool: TOOL_NAMES[i],
          provider: prov.name,
          model,
        });

        // Use the first active tool as primary display
        if (!primaryProvider) {
          primaryProvider = prov;
          primaryModel = model;
          primaryTool = TOOL_NAMES[i];
        }
      }

      setActiveProvider(primaryProvider);
      setActiveModel(primaryModel);
      setActiveTool(primaryTool);
      setAllActiveInfo(infoList);
    } catch {
      // Backend not ready or no data
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  // Close expanded view when clicking outside
  useEffect(() => {
    if (!expanded) return;
    const handleClick = (e: MouseEvent) => {
      if (islandRef.current && !islandRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [expanded]);

  const hasAiInfo = activeProvider !== null;
  const hasUsage = usage !== null && usage.totalRequests > 0;

  return (
    <div
      ref={islandRef}
      className={`dynamic-island ${expanded ? 'expanded' : ''} ${hasAiInfo ? 'has-data' : 'no-data'}`}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Compact View */}
      <div className="island-compact">
        {hasAiInfo ? (
          <>
            <div className="island-chip ai-chip">
              <Brain size={12} />
              <span className="island-label">
                {activeTool}{activeModel ? ` · ${shortenModel(activeModel)}` : ''}
              </span>
            </div>
            {hasUsage && (
              <div className="island-chip usage-chip">
                <Zap size={11} />
                <span className="island-label">{formatCost(usage!.totalCost)}</span>
              </div>
            )}
          </>
        ) : (
          <div className="island-chip idle-chip">
            <Brain size={12} />
            <span className="island-label">{t('island_no_provider')}</span>
          </div>
        )}
        {connectedCount > 0 && (
          <div className="island-chip conn-chip">
            <Wifi size={11} />
            <span className="island-label">{connectedCount}</span>
          </div>
        )}
        <ChevronDown size={10} className={`island-arrow ${expanded ? 'rotated' : ''}`} />
      </div>

      {/* Expanded View */}
      {expanded && (
        <div className="island-expanded" onClick={(e) => e.stopPropagation()}>
          {/* Active AI Providers Section */}
          <div className="island-section">
            <div className="island-section-title">
              <Brain size={13} />
              {t('island_active_ai')}
            </div>
            {allActiveInfo.length > 0 ? (
              allActiveInfo.map((info) => (
                <div key={info.tool} className="island-row">
                  <span className="island-row-tool">{info.tool}</span>
                  <span className="island-row-provider">{info.provider}</span>
                  {info.model && (
                    <span className="island-row-model">{shortenModel(info.model)}</span>
                  )}
                </div>
              ))
            ) : (
              <div className="island-row island-empty">{t('island_no_provider_desc')}</div>
            )}
          </div>

          {/* Today's Usage Section */}
          <div className="island-section">
            <div className="island-section-title">
              <Activity size={13} />
              {t('island_today_usage')}
            </div>
            {hasUsage ? (
              <div className="island-stats">
                <div className="island-stat">
                  <DollarSign size={12} />
                  <span className="island-stat-value">{formatCost(usage!.totalCost)}</span>
                  <span className="island-stat-label">{t('island_cost')}</span>
                </div>
                <div className="island-stat">
                  <Zap size={12} />
                  <span className="island-stat-value">{formatTokens(usage!.totalTokens)}</span>
                  <span className="island-stat-label">Tokens</span>
                </div>
                <div className="island-stat">
                  <MessageSquare size={12} />
                  <span className="island-stat-value">{usage!.totalRequests}</span>
                  <span className="island-stat-label">{t('island_requests')}</span>
                </div>
              </div>
            ) : (
              <div className="island-row island-empty">{t('island_no_usage')}</div>
            )}
          </div>

          {/* Connections Section */}
          <div className="island-section">
            <div className="island-section-title">
              <Wifi size={13} />
              {t('island_connections')}
            </div>
            <div className="island-row">
              <span className="island-conn-count">{connectedCount}</span>
              <span className="island-conn-label">{t('island_active_sessions')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
