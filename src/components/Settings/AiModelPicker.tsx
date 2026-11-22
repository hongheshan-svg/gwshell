import React, { useMemo } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { aiModelGroupLabels, aiModelPresets, type AiModelGroup } from '../../lib/aiModels';

type ModelTab = AiModelGroup | 'all';
const modelTabs: ModelTab[] = ['all', 'china', 'openai', 'anthropic', 'local'];

interface Props {
  activePresetId: string | undefined;
  activeTab: ModelTab;
  onTabChange: (tab: ModelTab) => void;
  onApply: (presetId: string) => void;
  busy: boolean;
}

export const AiModelPicker: React.FC<Props> = ({
  activePresetId,
  activeTab,
  onTabChange,
  onApply,
  busy,
}) => {
  const { t } = useTranslation();
  const visiblePresets = useMemo(
    () =>
      activeTab === 'all' ? aiModelPresets : aiModelPresets.filter((p) => p.group === activeTab),
    [activeTab],
  );

  return (
    <section className="ai-card ai-preset-card-shell">
      <div className="ai-card-header">
        <div className="ai-card-heading">
          <Sparkles size={14} />
          <span>{t('agent_ai_model_library')}</span>
        </div>
        <div className="ai-preset-tabs" role="tablist">
          {modelTabs.map((tab) => (
            <button
              className={`ai-preset-tab${activeTab === tab ? ' is-active' : ''}`}
              disabled={busy}
              key={tab}
              onClick={() => onTabChange(tab)}
              role="tab"
              aria-selected={activeTab === tab}
              type="button"
            >
              {tab === 'all' ? t('agent_ai_group_all') : t(aiModelGroupLabels[tab])}
            </button>
          ))}
        </div>
      </div>

      <div className="ai-preset-grid">
        {visiblePresets.map((preset) => {
          const active = activePresetId === preset.id;
          return (
            <button
              className={`ai-preset-item${active ? ' is-active' : ''}`}
              disabled={busy}
              key={preset.id}
              onClick={() => onApply(preset.id)}
              type="button"
            >
              <div className="ai-preset-item-top">
                <span className="ai-preset-vendor">{preset.vendor}</span>
                {active ? (
                  <span className="ai-preset-active-badge">
                    <Check size={11} />
                  </span>
                ) : (
                  <span className="ai-preset-tier">{t(preset.badgeKey)}</span>
                )}
              </div>
              <div className="ai-preset-title">{preset.title}</div>
              <code className="ai-preset-model-id">{preset.model}</code>
            </button>
          );
        })}
      </div>
    </section>
  );
};
