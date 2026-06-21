import React, { useMemo } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  aiModelGroupLabels,
  aiModelPresets,
  compatibleProviderLabels,
  type AiModelGroup,
} from '../../lib/aiModels';

type ModelTab = AiModelGroup | 'all';
const modelTabs: ModelTab[] = ['all', 'china', 'openai', 'anthropic', 'local'];

interface Props {
  activePresetId: string | undefined;
  activeTab: ModelTab;
  onTabChange: (tab: ModelTab) => void;
  onApply: (presetId: string) => void;
  busy: boolean;
}

export const AiModelPicker: React.FC<Props> = ({ activePresetId, activeTab, onTabChange, onApply, busy }) => {
  const { t } = useTranslation();
  const visiblePresets = useMemo(
    () => (activeTab === 'all' ? aiModelPresets : aiModelPresets.filter((p) => p.group === activeTab)),
    [activeTab],
  );
  return (
    <section className="ai-settings-block ai-model-picker">
      <div className="ai-settings-block-header">
        <div>
          <div className="ai-settings-block-title">{t('agent_ai_model_library')}</div>
        </div>
      </div>
      <div className="ai-model-tabs">
        {modelTabs.map((tab) => (
          <button
            className={activeTab === tab ? 'active' : ''}
            disabled={busy}
            key={tab}
            onClick={() => onTabChange(tab)}
            type="button"
          >
            {tab === 'all' ? t('agent_ai_group_all') : t(aiModelGroupLabels[tab])}
          </button>
        ))}
      </div>
      <div className="ai-model-card-list">
        {visiblePresets.map((preset) => {
          const active = activePresetId === preset.id;
          return (
            <button
              className={`ai-model-card${active ? ' active' : ''}`}
              disabled={busy}
              key={preset.id}
              onClick={() => onApply(preset.id)}
              type="button"
            >
              <span className="ai-model-card-head">
                <strong>{preset.vendor} · {preset.title}</strong>
                {active ? <Check size={14} className="ai-model-card-check" /> : <small>{t(preset.badgeKey)}</small>}
              </span>
              <span className="ai-model-card-scene">{t(preset.descriptionKey)}</span>
              <span className="ai-model-card-proto">{compatibleProviderLabels[preset.provider]}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
