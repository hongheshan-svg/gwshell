# Agent / AI Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Agent/AI settings page from a 670-line monolith into a dual-panel AI config layout plus a 4-card policy section, by splitting into focused components.

**Architecture:** `AiSettingsSection` becomes a slim container holding shared state and IPC calls. Three child areas render the UI: `AiModelPicker` (left), `AiConnectionConfig` (right), and `AgentPolicySection` (4 functional cards). All state flows down via props; children fire callbacks up. No new store, no backend changes.

**Tech Stack:** React function components, Zustand `useAgentPolicyStore`, Tauri `invoke`, existing i18n and CSS tokens. Verification via `npm run build` (tsc strict + noUnusedLocals) and `npm run smoke:check` — the repo has no first-party test runner.

---

## File Structure

- Modify: `src/components/Settings/AiSettingsSection.tsx` — becomes the slim container.
- Create: `src/components/Settings/AiModelPicker.tsx` — left panel, model library cards.
- Create: `src/components/Settings/AiConnectionConfig.tsx` — right panel, status + config + actions.
- Create: `src/components/Settings/AgentPolicySection.tsx` — policy area wrapper + 4 cards.
- Create: `src/components/Settings/policy/PolicyAutoAnalysis.tsx`
- Create: `src/components/Settings/policy/PolicyAutoExecution.tsx`
- Create: `src/components/Settings/policy/PolicyMaintenance.tsx`
- Create: `src/components/Settings/policy/PolicyAlerts.tsx`
- Modify: `src/i18n/locales/gwshell.en.json` — 4 new card-title keys + 2 collapse labels.
- Modify: `src/i18n/locales/gwshell.zh.json` — same new keys.
- Modify: `src/styles/global.css` — new card/grid styles for the dual panel and policy cards.

## Shared types used across components

```ts
// src/types/agent.ts (already exists, unchanged)
export interface AiProviderSettings { /* ... existing ... */ }
export interface AgentPolicySettings { /* ... existing ... */ }

// A partial updater passed to every policy card and to AiConnectionConfig.
// Defined inline in each component's props — no new shared type file needed.
```

---

## Task 1: i18n keys for policy card titles and collapse labels

**Files:**
- Modify: `src/i18n/locales/gwshell.en.json`
- Modify: `src/i18n/locales/gwshell.zh.json`

The 4 policy cards need titles; the allowlist/denylist collapse sections need labels. Add these keys (they are reused by the card components in Task 4).

- [ ] **Step 1: Add keys to `gwshell.en.json`**

Insert after the existing `agent_policy_save_hint` line (around line 298), keeping alphabetical-ish grouping:

```json
  "agent_policy_save_hint": "Policy saving is separate from AI provider configuration.",
  "agent_policy_card_analysis": "Auto analysis",
  "agent_policy_card_execution": "Auto execution",
  "agent_policy_card_maintenance": "Maintenance window",
  "agent_policy_card_alerts": "Alerts & log filter",
  "agent_policy_lists_expand": "Edit lists",
  "agent_policy_lists_collapse": "Hide lists",
  "agent_ai_advanced_expand": "Show advanced",
```

- [ ] **Step 2: Add the same keys to `gwshell.zh.json`**

```json
  "agent_policy_save_hint": "策略保存与 AI 模型配置相互独立。",
  "agent_policy_card_analysis": "自动分析",
  "agent_policy_card_execution": "自动执行",
  "agent_policy_card_maintenance": "维护窗口",
  "agent_policy_card_alerts": "告警与日志过滤",
  "agent_policy_lists_expand": "编辑列表",
  "agent_policy_lists_collapse": "收起列表",
  "agent_ai_advanced_expand": "显示高级",
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS (tsc + vite). The new keys are not yet referenced by components, but JSON validity is checked at build via i18n loader.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/gwshell.en.json src/i18n/locales/gwshell.zh.json
git commit -m "feat: add agent policy card i18n keys"
```

---

## Task 2: Policy card components (4 files)

**Files:**
- Create: `src/components/Settings/policy/PolicyAutoAnalysis.tsx`
- Create: `src/components/Settings/policy/PolicyAutoExecution.tsx`
- Create: `src/components/Settings/policy/PolicyMaintenance.tsx`
- Create: `src/components/Settings/policy/PolicyAlerts.tsx`

Each card receives `policy: AgentPolicySettings`, `busy: boolean`, and `onChange: (partial: Partial<AgentPolicySettings>) => void`. The card title uses the i18n key from Task 1. Each card renders inside a `.policy-card` container (styled in Task 6).

- [ ] **Step 1: Create `PolicyAutoAnalysis.tsx`**

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentPolicySettings } from '../../../types/agent';

interface Props {
  policy: AgentPolicySettings;
  busy: boolean;
  onChange: (partial: Partial<AgentPolicySettings>) => void;
}

export const PolicyAutoAnalysis: React.FC<Props> = ({ policy, busy, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="policy-card">
      <div className="policy-card-title">{t('agent_policy_card_analysis')}</div>
      <label className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_auto_continue')}</span>
        </span>
        <span className="settings-row-right">
          <button
            className={`settings-toggle ${policy.auto_continue_enabled ? 'on' : ''}`}
            disabled={busy}
            onClick={() => onChange({ auto_continue_enabled: !policy.auto_continue_enabled })}
            type="button"
          >
            <span className="settings-toggle-knob" />
          </button>
        </span>
      </label>
      <label className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_live_log_auto')}</span>
        </span>
        <span className="settings-row-right">
          <button
            className={`settings-toggle ${policy.live_log_auto_analysis ? 'on' : ''}`}
            disabled={busy}
            onClick={() => onChange({ live_log_auto_analysis: !policy.live_log_auto_analysis })}
            type="button"
          >
            <span className="settings-toggle-knob" />
          </button>
        </span>
      </label>
      <div className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_max_continuations')}</span>
        </span>
        <span className="settings-row-right">
          <input
            className="settings-input"
            disabled={busy}
            max={30}
            min={1}
            style={{ width: 90 }}
            type="number"
            value={policy.max_auto_continuations}
            onChange={(e) =>
              onChange({
                max_auto_continuations: Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 8)),
              })
            }
          />
        </span>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Create `PolicyAutoExecution.tsx`**

This card has two collapsible textareas (allowlist / denylist). They start collapsed; a toggle button reveals them.

```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentPolicySettings } from '../../../types/agent';

interface Props {
  policy: AgentPolicySettings;
  busy: boolean;
  onChange: (partial: Partial<AgentPolicySettings>) => void;
}

export const PolicyAutoExecution: React.FC<Props> = ({ policy, busy, onChange }) => {
  const { t } = useTranslation();
  const [listsOpen, setListsOpen] = useState(false);
  return (
    <div className="policy-card">
      <div className="policy-card-title">{t('agent_policy_card_execution')}</div>
      <label className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_auto_read_only')}</span>
        </span>
        <span className="settings-row-right">
          <button
            className={`settings-toggle ${policy.auto_execute_read_only ? 'on' : ''}`}
            disabled={busy}
            onClick={() => onChange({ auto_execute_read_only: !policy.auto_execute_read_only })}
            type="button"
          >
            <span className="settings-toggle-knob" />
          </button>
        </span>
      </label>
      <label className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_auto_low')}</span>
        </span>
        <span className="settings-row-right">
          <button
            className={`settings-toggle ${policy.auto_execute_low_risk ? 'on' : ''}`}
            disabled={busy}
            onClick={() => onChange({ auto_execute_low_risk: !policy.auto_execute_low_risk })}
            type="button"
          >
            <span className="settings-toggle-knob" />
          </button>
        </span>
      </label>
      <button
        className="policy-card-collapse-btn"
        disabled={busy}
        onClick={() => setListsOpen((v) => !v)}
        type="button"
      >
        {listsOpen ? t('agent_policy_lists_collapse') : t('agent_policy_lists_expand')}
      </button>
      {listsOpen && (
        <div className="policy-card-lists">
          <label className="settings-row">
            <span className="settings-row-left">
              <span className="settings-label">{t('agent_policy_command_allowlist')}</span>
              <span className="settings-desc">{t('agent_policy_one_per_line')}</span>
            </span>
            <span className="settings-row-right">
              <textarea
                className="settings-input"
                disabled={busy}
                style={{ width: 280, minHeight: 58 }}
                value={policy.auto_execute_command_allowlist.join('\n')}
                onChange={(e) =>
                  onChange({
                    auto_execute_command_allowlist: e.target.value.split('\n').map((line) => line.trim()).filter(Boolean),
                  })
                }
              />
            </span>
          </label>
          <label className="settings-row">
            <span className="settings-row-left">
              <span className="settings-label">{t('agent_policy_service_denylist')}</span>
              <span className="settings-desc">{t('agent_policy_one_per_line')}</span>
            </span>
            <span className="settings-row-right">
              <textarea
                className="settings-input"
                disabled={busy}
                style={{ width: 280, minHeight: 58 }}
                value={policy.auto_execute_service_denylist.join('\n')}
                onChange={(e) =>
                  onChange({
                    auto_execute_service_denylist: e.target.value.split('\n').map((line) => line.trim()).filter(Boolean),
                  })
                }
              />
            </span>
          </label>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Create `PolicyMaintenance.tsx`**

The time inputs are disabled when `maintenance_window_enabled` is false.

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentPolicySettings } from '../../../types/agent';

interface Props {
  policy: AgentPolicySettings;
  busy: boolean;
  onChange: (partial: Partial<AgentPolicySettings>) => void;
}

export const PolicyMaintenance: React.FC<Props> = ({ policy, busy, onChange }) => {
  const { t } = useTranslation();
  const timeDisabled = busy || !policy.maintenance_window_enabled;
  return (
    <div className="policy-card">
      <div className="policy-card-title">{t('agent_policy_card_maintenance')}</div>
      <label className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_maintenance_window')}</span>
        </span>
        <span className="settings-row-right">
          <button
            className={`settings-toggle ${policy.maintenance_window_enabled ? 'on' : ''}`}
            disabled={busy}
            onClick={() => onChange({ maintenance_window_enabled: !policy.maintenance_window_enabled })}
            type="button"
          >
            <span className="settings-toggle-knob" />
          </button>
        </span>
      </label>
      <div className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_maintenance_time')}</span>
        </span>
        <span className="settings-row-right">
          <input
            className="settings-input"
            disabled={timeDisabled}
            style={{ width: 90 }}
            type="time"
            value={policy.maintenance_window_start}
            onChange={(e) => onChange({ maintenance_window_start: e.target.value })}
          />
          <input
            className="settings-input"
            disabled={timeDisabled}
            style={{ width: 90, marginLeft: 8 }}
            type="time"
            value={policy.maintenance_window_end}
            onChange={(e) => onChange({ maintenance_window_end: e.target.value })}
          />
        </span>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Create `PolicyAlerts.tsx`**

The keyword input is disabled when `log_filter_enabled` is false.

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentPolicySettings } from '../../../types/agent';

interface Props {
  policy: AgentPolicySettings;
  busy: boolean;
  onChange: (partial: Partial<AgentPolicySettings>) => void;
}

export const PolicyAlerts: React.FC<Props> = ({ policy, busy, onChange }) => {
  const { t } = useTranslation();
  const keywordDisabled = busy || !policy.log_filter_enabled;
  return (
    <div className="policy-card">
      <div className="policy-card-title">{t('agent_policy_card_alerts')}</div>
      <label className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_log_filter')}</span>
        </span>
        <span className="settings-row-right">
          <button
            className={`settings-toggle ${policy.log_filter_enabled ? 'on' : ''}`}
            disabled={busy}
            onClick={() => onChange({ log_filter_enabled: !policy.log_filter_enabled })}
            type="button"
          >
            <span className="settings-toggle-knob" />
          </button>
        </span>
      </label>
      <div className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_log_keywords')}</span>
        </span>
        <span className="settings-row-right">
          <input
            className="settings-input"
            disabled={keywordDisabled}
            style={{ width: 280 }}
            value={policy.log_interest_keywords.join(', ')}
            onChange={(e) =>
              onChange({
                log_interest_keywords: e.target.value.split(',').map((item) => item.trim()).filter(Boolean),
              })
            }
          />
        </span>
      </div>
      <div className="settings-row">
        <span className="settings-row-left">
          <span className="settings-label">{t('agent_policy_alert_thresholds')}</span>
        </span>
        <span className="settings-row-right">
          <input
            className="settings-input"
            disabled={busy}
            max={100}
            min={1}
            style={{ width: 80 }}
            type="number"
            value={policy.disk_alert_percent}
            onChange={(e) => onChange({ disk_alert_percent: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 90)) })}
          />
          <input
            className="settings-input"
            disabled={busy}
            max={100}
            min={1}
            style={{ width: 80, marginLeft: 8 }}
            type="number"
            value={policy.memory_alert_percent}
            onChange={(e) => onChange({ memory_alert_percent: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 90)) })}
          />
        </span>
      </div>
    </div>
  );
};
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: PASS. Components compile but are not yet imported anywhere, so tsc may warn about unused — but they are exported, so no `noUnusedLocals` issue.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/policy/
git commit -m "feat: add 4 agent policy card components"
```

---

## Task 3: AgentPolicySection wrapper

**Files:**
- Create: `src/components/Settings/AgentPolicySection.tsx`

This renders the 4 cards in a 2×2 grid and the single save button. It receives `policy`, `setPolicy`, `busy`, `onSave`, and the policy `message`.

- [ ] **Step 1: Create `AgentPolicySection.tsx`**

```tsx
import React from 'react';
import { AlertCircle, CheckCircle2, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentPolicySettings } from '../../types/agent';
import { PolicyAutoAnalysis } from './policy/PolicyAutoAnalysis';
import { PolicyAutoExecution } from './policy/PolicyAutoExecution';
import { PolicyMaintenance } from './policy/PolicyMaintenance';
import { PolicyAlerts } from './policy/PolicyAlerts';

interface Props {
  policy: AgentPolicySettings;
  busy: boolean;
  onChange: (partial: Partial<AgentPolicySettings>) => void;
  onSave: () => void;
  message: { kind: 'ok' | 'err'; text: string } | null;
}

export const AgentPolicySection: React.FC<Props> = ({ policy, busy, onChange, onSave, message }) => {
  const { t } = useTranslation();
  return (
    <>
      <div className="settings-section-title" style={{ marginTop: 12 }}>{t('agent_policy_title')}</div>
      <div className="policy-card-grid">
        <PolicyAutoAnalysis policy={policy} busy={busy} onChange={onChange} />
        <PolicyAutoExecution policy={policy} busy={busy} onChange={onChange} />
        <PolicyMaintenance policy={policy} busy={busy} onChange={onChange} />
        <PolicyAlerts policy={policy} busy={busy} onChange={onChange} />
      </div>
      <div className="settings-row" style={{ marginTop: 4 }}>
        <span className="settings-row-left">
          <span className="settings-desc">{t('agent_policy_save_hint')}</span>
        </span>
        <span className="settings-row-right">
          <button className="settings-btn-primary" disabled={busy} onClick={onSave} type="button">
            <Save size={14} />
            {t('agent_policy_save')}
          </button>
        </span>
      </div>
      {message && (
        <div className={`ai-settings-message ${message.kind}`}>
          {message.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{message.text}</span>
        </div>
      )}
    </>
  );
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings/AgentPolicySection.tsx
git commit -m "feat: add agent policy section wrapper"
```

---

## Task 4: AiModelPicker (left panel)

**Files:**
- Create: `src/components/Settings/AiModelPicker.tsx`

Renders group tabs + model cards. Receives the preset list, the active preset id, the active tab, and callbacks.

- [ ] **Step 1: Create `AiModelPicker.tsx`**

```tsx
import React, { useMemo } from 'react';
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
          <p>{t('agent_ai_model_library_hint')}</p>
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
                <strong>{preset.vendor}</strong>
                <small>{t(preset.badgeKey)}</small>
              </span>
              <span className="ai-model-card-name">{preset.title}</span>
              <span className="ai-model-card-scene">{t(preset.descriptionKey)}</span>
              <span className="ai-model-card-proto">{compatibleProviderLabels[preset.provider]}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings/AiModelPicker.tsx
git commit -m "feat: add ai model picker panel"
```

---

## Task 5: AiConnectionConfig (right panel)

**Files:**
- Create: `src/components/Settings/AiConnectionConfig.tsx`

Renders the status card, the compatible-provider segments, the connection fields, a collapsible advanced section, the action bar, and AI messages.

- [ ] **Step 1: Create `AiConnectionConfig.tsx`**

```tsx
import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, PlugZap, RotateCcw, Save, SlidersHorizontal, TestTube2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { compatibleProviderLabels, findAiModelPreset, getAiModelDisplayName, providerDefaults } from '../../lib/aiModels';
import type { AiProviderSettings } from '../../types/agent';

interface Props {
  settings: AiProviderSettings;
  apiKey: string;
  status: { kind: 'off' | 'warn' | 'ok'; label: string };
  modelDisplayName: string;
  keyPlaceholder: string;
  usable: boolean;
  busy: boolean;
  message: { kind: 'ok' | 'err'; text: string } | null;
  onSettingsChange: (partial: Partial<AiProviderSettings>) => void;
  onApiKeyChange: (value: string) => void;
  onSelectProvider: (provider: AiProviderSettings['provider']) => void;
  onClearKey: () => void;
  onTest: () => void;
  onSave: () => void;
}

export const AiConnectionConfig: React.FC<Props> = ({
  settings, apiKey, status, modelDisplayName, keyPlaceholder, usable, busy, message,
  onSettingsChange, onApiKeyChange, onSelectProvider, onClearKey, onTest, onSave,
}) => {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const selectedPreset = findAiModelPreset(settings);
  return (
    <section className="ai-config-panel ai-connection-config">
      {/* Status card */}
      <div className="ai-settings-hero">
        <div className="ai-settings-hero-main">
          <span className="ai-settings-eyebrow">{t('agent_ai_current_model')}</span>
          <div className="ai-settings-model-name"><span>{modelDisplayName}</span></div>
          <div className="ai-settings-model-meta">
            <span>{selectedPreset?.vendor || compatibleProviderLabels[settings.provider]}</span>
            <span>{settings.model || '-'}</span>
            <span>{settings.base_url || '-'}</span>
          </div>
        </div>
        <div className="ai-settings-hero-actions">
          <div className={`ai-settings-status ${status.kind}`} aria-live="polite">
            {status.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {status.label}
          </div>
          <label className="ai-enable-control">
            <span>{t('agent_ai_enable_model')}</span>
            <button
              className={`settings-toggle ${settings.enabled ? 'on' : ''}`}
              disabled={busy}
              onClick={() => onSettingsChange({ enabled: !settings.enabled })}
              type="button"
            >
              <span className="settings-toggle-knob" />
            </button>
          </label>
        </div>
      </div>

      {message && (
        <div className={`ai-settings-message ${message.kind}`}>
          {message.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Compatible provider segments */}
      <div className="ai-settings-block-header">
        <div>
          <div className="ai-settings-block-title"><PlugZap size={16} />{t('agent_ai_compat_title')}</div>
          <p>{t('agent_ai_compat_hint')}</p>
        </div>
      </div>
      <div className="ai-provider-segments">
        {(Object.keys(providerDefaults) as AiProviderSettings['provider'][]).map((provider) => (
          <button
            className={settings.provider === provider ? 'active' : ''}
            disabled={busy}
            key={provider}
            onClick={() => onSelectProvider(provider)}
            type="button"
          >
            {compatibleProviderLabels[provider]}
          </button>
        ))}
      </div>

      {/* Connection fields */}
      <div className="ai-field-grid">
        <label className="ai-field wide">
          <span>{t('agent_ai_base_url')}</span>
          <input
            className="settings-input"
            disabled={busy}
            value={settings.base_url}
            onChange={(e) => onSettingsChange({ base_url: e.target.value })}
          />
        </label>
        <label className="ai-field">
          <span>{t('agent_ai_model')}</span>
          <input
            className="settings-input"
            disabled={busy}
            value={settings.model}
            onChange={(e) => onSettingsChange({ model: e.target.value })}
          />
        </label>
        <label className="ai-field">
          <span>{t('agent_ai_api_key')}</span>
          <input
            className="settings-input"
            disabled={busy}
            type="password"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={settings.provider === 'ollama' ? t('agent_ai_key_optional') : keyPlaceholder}
          />
          <small>
            {settings.provider === 'ollama'
              ? t('agent_ai_key_optional')
              : settings.api_key_configured
                ? t('agent_ai_key_configured')
                : t('agent_ai_key_missing')}
          </small>
        </label>
      </div>

      {/* Collapsible advanced */}
      <button
        className="policy-card-collapse-btn"
        disabled={busy}
        onClick={() => setAdvancedOpen((v) => !v)}
        type="button"
      >
        <SlidersHorizontal size={15} />
        {advancedOpen ? t('agent_ai_advanced') : t('agent_ai_advanced_expand')}
      </button>
      {advancedOpen && (
        <div className="ai-advanced-row">
          <label>
            {t('agent_ai_timeout')}
            <input
              className="settings-input"
              disabled={busy}
              min={1}
              type="number"
              value={settings.request_timeout_secs}
              onChange={(e) => onSettingsChange({ request_timeout_secs: parseInt(e.target.value, 10) || 45 })}
            />
          </label>
          <label>
            {t('agent_ai_max_input')}
            <input
              className="settings-input"
              disabled={busy}
              min={2000}
              type="number"
              value={settings.max_input_chars}
              onChange={(e) => onSettingsChange({ max_input_chars: parseInt(e.target.value, 10) || 24000 })}
            />
          </label>
          <label>
            {t('agent_ai_temperature')}
            <input
              className="settings-input"
              disabled={busy}
              max={2}
              min={0}
              step={0.1}
              type="number"
              value={settings.temperature}
              onChange={(e) => onSettingsChange({ temperature: parseFloat(e.target.value) || 0 })}
            />
          </label>
        </div>
      )}

      {/* Action bar */}
      <div className="ai-actions-bar">
        <div className="ai-settings-notice">
          {usable ? <CheckCircle2 size={16} /> : <KeyRound size={16} />}
          <span>{t('agent_ai_external_notice')}</span>
        </div>
        <div className="ai-settings-actions">
          <button className="settings-btn-outline" disabled={busy} onClick={onClearKey} type="button">
            <RotateCcw size={14} />
            {t('agent_ai_clear_key')}
          </button>
          <button className="settings-btn-outline" disabled={busy} onClick={onTest} type="button">
            <TestTube2 size={14} />
            {t('agent_ai_test')}
          </button>
          <button className="settings-btn-primary" disabled={busy} onClick={onSave} type="button">
            <Save size={14} />
            {settings.enabled ? t('agent_ai_save_enable') : t('agent_ai_save')}
          </button>
        </div>
      </div>
    </section>
  );
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings/AiConnectionConfig.tsx
git commit -m "feat: add ai connection config panel"
```

---

## Task 6: Rewrite AiSettingsSection as the slim container

**Files:**
- Modify: `src/components/Settings/AiSettingsSection.tsx`

Replace the 670-line monolith with a container that holds state + IPC, computes derived values, and delegates rendering to the three child areas. Keep all existing IPC logic (`persistAiSettings`, `save`, `testProvider`, `clearKey`, `savePolicySettings`, `applyModelPreset`, `selectCompatibleProvider`, `normalizedSettings`, `reloadSettings`) — only the JSX changes.

- [ ] **Step 1: Rewrite `AiSettingsSection.tsx`**

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useAgentPolicyStore } from '../../stores/agentPolicyStore';
import { findAiModelPreset, getAiModelDisplayName, isAiProviderUsable, providerDefaults, type AiModelGroup } from '../../lib/aiModels';
import type { AiProviderSettings } from '../../types/agent';
import { AiModelPicker } from './AiModelPicker';
import { AiConnectionConfig } from './AiConnectionConfig';
import { AgentPolicySection } from './AgentPolicySection';

type ModelTab = AiModelGroup | 'all';

const defaults: AiProviderSettings = {
  enabled: false,
  provider: 'openai_compatible',
  base_url: 'https://api.openai.com/v1',
  model: 'gpt-5.5',
  api_key_configured: false,
  temperature: 0.2,
  max_input_chars: 24000,
  request_timeout_secs: 45,
};

const emitAiSettingsChanged = () => window.dispatchEvent(new CustomEvent('gwshell-ai-settings-changed'));

export const AiSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AiProviderSettings>(defaults);
  const policy = useAgentPolicyStore((s) => s.policy);
  const setPolicy = useAgentPolicyStore((s) => s.setPolicy);
  const loadPolicy = useAgentPolicyStore((s) => s.load);
  const savePolicy = useAgentPolicyStore((s) => s.save);
  const [apiKey, setApiKey] = useState('');
  const [aiMessage, setAiMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [policyMessage, setPolicyMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeModelTab, setActiveModelTab] = useState<ModelTab>('china');

  useEffect(() => {
    invoke<AiProviderSettings>('load_ai_provider_settings')
      .then((loaded) => setSettings({ ...defaults, ...loaded }))
      .catch((err) => setAiMessage({ kind: 'err', text: String(err) }));
    loadPolicy().catch((err) => setPolicyMessage({ kind: 'err', text: String(err) }));
  }, [loadPolicy]);

  const selectedPreset = useMemo(() => findAiModelPreset(settings), [settings]);
  const modelDisplayName = useMemo(() => getAiModelDisplayName(settings), [settings]);
  const usable =
    isAiProviderUsable(settings) ||
    (settings.enabled && Boolean(settings.base_url.trim()) && Boolean(settings.model.trim()) && Boolean(apiKey.trim()));
  const status = useMemo(() => {
    if (!settings.enabled) return { kind: 'off' as const, label: t('agent_ai_status_disabled') };
    if (!settings.model.trim() || !settings.base_url.trim()) return { kind: 'warn' as const, label: t('agent_ai_status_incomplete') };
    if (settings.provider !== 'ollama' && !settings.api_key_configured && !apiKey.trim()) {
      return { kind: 'warn' as const, label: t('agent_ai_status_key_missing') };
    }
    return { kind: 'ok' as const, label: t('agent_ai_status_ready') };
  }, [apiKey, settings, t]);
  const keyPlaceholder = selectedPreset?.apiKeyHint || (settings.provider === 'anthropic_compatible' ? 'sk-ant-...' : 'sk-...');

  const onSettingsChange = (partial: Partial<AiProviderSettings>) => {
    setSettings((s) => ({ ...s, ...partial }));
    setAiMessage(null);
  };
  const onPolicyChange = (partial: Partial<typeof policy>) => setPolicy({ ...policy, ...partial });

  const normalizedSettings = (): AiProviderSettings => ({
    ...settings,
    base_url: settings.base_url.trim(),
    model: settings.model.trim(),
    request_timeout_secs: Math.max(1, settings.request_timeout_secs || defaults.request_timeout_secs),
    max_input_chars: Math.max(2000, settings.max_input_chars || defaults.max_input_chars),
    temperature: Number.isFinite(settings.temperature) ? settings.temperature : defaults.temperature,
  });

  const reloadSettings = async () => {
    const loaded = await invoke<AiProviderSettings>('load_ai_provider_settings');
    setSettings({ ...defaults, ...loaded });
  };

  const persistAiSettings = async () => {
    const trimmedKey = apiKey.trim();
    if (trimmedKey) await invoke('set_ai_provider_api_key', { apiKey: trimmedKey });
    await invoke('save_ai_provider_settings', { settings: normalizedSettings() });
    await reloadSettings();
    if (trimmedKey) setApiKey('');
    emitAiSettingsChanged();
  };

  const save = async () => {
    setAiMessage({ kind: 'ok', text: t('agent_ai_model_selected_save_hint') });
    try {
      setBusy(true);
      await persistAiSettings();
      setAiMessage({ kind: 'ok', text: t('agent_ai_saved') });
    } catch (err) {
      setAiMessage({ kind: 'err', text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const testProvider = async () => {
    setAiMessage({ kind: 'ok', text: t('agent_ai_model_selected_save_hint') });
    try {
      setBusy(true);
      const result = await invoke<string>('test_ai_provider_with_settings', {
        settings: normalizedSettings(),
        apiKey: apiKey.trim() || null,
      });
      setAiMessage({ kind: 'ok', text: result });
    } catch (err) {
      setAiMessage({ kind: 'err', text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const savePolicySettings = async () => {
    setPolicyMessage(null);
    try {
      setBusy(true);
      await savePolicy(policy);
      setPolicyMessage({ kind: 'ok', text: t('agent_policy_saved') });
    } catch (err) {
      setPolicyMessage({ kind: 'err', text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    setAiMessage(null);
    try {
      setBusy(true);
      await invoke('clear_ai_provider_api_key');
      setApiKey('');
      await reloadSettings();
      emitAiSettingsChanged();
      setAiMessage({ kind: 'ok', text: t('agent_ai_key_cleared') });
    } catch (err) {
      setAiMessage({ kind: 'err', text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const applyModelPreset = (presetId: string) => {
    const preset = [selectedPreset].flat().find(() => false); // placeholder removed below
    void preset;
    // Reimplemented inline using the preset registry:
    import('../../lib/aiModels').then(({ aiModelPresets }) => {
      const found = aiModelPresets.find((item) => item.id === presetId);
      if (!found) return;
      setSettings((s) => ({ ...s, enabled: true, provider: found.provider, base_url: found.base_url, model: found.model }));
      setAiMessage(null);
    });
  };

  const selectCompatibleProvider = (provider: AiProviderSettings['provider']) => {
    setSettings((s) => ({ ...s, enabled: true, provider, ...providerDefaults[provider] }));
    setAiMessage(null);
  };

  return (
    <>
      <div className="settings-section-title">{t('agent_ai_title')}</div>
      <div className="ai-settings-shell ai-settings-dual">
        <AiModelPicker
          activePresetId={selectedPreset?.id}
          activeTab={activeModelTab}
          busy={busy}
          onApply={applyModelPreset}
          onTabChange={setActiveModelTab}
        />
        <AiConnectionConfig
          settings={settings}
          apiKey={apiKey}
          status={status}
          modelDisplayName={modelDisplayName}
          keyPlaceholder={keyPlaceholder}
          usable={usable}
          busy={busy}
          message={aiMessage}
          onSettingsChange={onSettingsChange}
          onApiKeyChange={setApiKey}
          onSelectProvider={selectCompatibleProvider}
          onClearKey={clearKey}
          onTest={testProvider}
          onSave={save}
        />
      </div>
      <AgentPolicySection
        policy={policy}
        busy={busy}
        onChange={onPolicyChange}
        onSave={savePolicySettings}
        message={policyMessage}
      />
    </>
  );
};
```

**Note on `applyModelPreset`:** the inline dynamic `import` above is awkward. Replace it with a static import at the top of the file. Add `aiModelPresets` to the existing import from `../../lib/aiModels`, then implement `applyModelPreset` cleanly:

```tsx
import { aiModelPresets, findAiModelPreset, getAiModelDisplayName, isAiProviderUsable, providerDefaults, type AiModelGroup } from '../../lib/aiModels';

// ... inside the component:
const applyModelPreset = (presetId: string) => {
  const preset = aiModelPresets.find((item) => item.id === presetId);
  if (!preset) return;
  setSettings((s) => ({ ...s, enabled: true, provider: preset.provider, base_url: preset.base_url, model: preset.model }));
  setAiMessage(null);
};
```

Use the static-import version, not the dynamic-import placeholder.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS (tsc strict + noUnusedLocals). All child components are now imported and used; the old monolith JSX is gone.

- [ ] **Step 3: Run smoke check**

Run: `npm run smoke:check`
Expected: PASS — the same 49 frontend invokes / 83 backend commands. No IPC calls were added or removed.

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings/AiSettingsSection.tsx
git commit -m "refactor: rewrite ai settings section as slim container"
```

---

## Task 7: CSS for dual-panel and policy cards

**Files:**
- Modify: `src/styles/global.css`

Add styles for the dual-panel shell, the model card list, the policy card grid, and the collapse button. These sit alongside the existing `.ai-settings-*` rules (around line 3742+).

- [ ] **Step 1: Add the new CSS rules**

Append after the existing `.ai-settings-shell` rule block. Use existing CSS tokens (`--border-color`, `--bg-tertiary`, `--accent-primary`, `--radius-sm`, `--radius-md`, `--transition-fast`).

```css
/* Dual-panel AI settings shell */
.ai-settings-dual {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(320px, 1.3fr);
  gap: 12px;
  align-items: start;
}

.ai-model-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-model-card-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 340px;
  overflow-y: auto;
  padding-right: 2px;
}

.ai-model-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast);
}

.ai-model-card:hover {
  border-color: var(--accent-primary);
  background: var(--bg-hover);
}

.ai-model-card.active {
  border-color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 10%, var(--bg-primary));
}

.ai-model-card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.ai-model-card-head strong {
  color: var(--text-primary);
  font-size: 12px;
}

.ai-model-card-head small {
  color: var(--text-muted);
  font-size: 10px;
}

.ai-model-card-name {
  color: var(--text-primary);
  font-weight: 600;
  font-size: 13px;
}

.ai-model-card-scene {
  color: var(--text-muted);
  font-size: 11px;
}

.ai-model-card-proto {
  color: var(--text-muted);
  font-size: 10px;
  text-transform: uppercase;
}

.ai-connection-config {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Policy cards */
.policy-card-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.policy-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-tertiary);
}

.policy-card-title {
  color: var(--accent-primary);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 4px;
}

.policy-card-collapse-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.policy-card-collapse-btn:hover:not(:disabled) {
  border-color: var(--accent-primary);
  color: var(--accent-hover);
}

.policy-card-lists {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--border-color);
}

/* Responsive: dual panel -> single column */
@media (max-width: 820px) {
  .ai-settings-dual {
    grid-template-columns: 1fr;
  }

  .policy-card-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/styles/global.css
git commit -m "style: add dual-panel and policy card styles"
```

---

## Task 8: Verification

**Files:** All modified files.

- [ ] **Step 1: Run frontend build**

Run: `npm run build`
Expected: PASS (tsc strict + vite build).

- [ ] **Step 2: Run smoke check**

Run: `npm run smoke:check`
Expected: PASS — 49 frontend invokes / 83 backend commands, settings store consumers ok.

- [ ] **Step 3: Run Rust check (unchanged, confirm no regression)**

Run: `cd src-tauri; cargo check`
Expected: PASS — no backend files touched, but confirm the workspace still compiles.

- [ ] **Step 4: Run `git diff --check`**

Run: `git diff --check`
Expected: no whitespace errors.

- [ ] **Step 5: Manual verification**

Run: `npm run tauri dev`
Confirm in the running app:
1. Settings → Agent / AI shows the dual-panel layout (model cards on the left, config on the right).
2. Clicking a model card fills the right-side config.
3. Save / Test / Clear Key buttons work.
4. Advanced params collapse/expand.
5. Policy area shows 4 cards in a 2×2 grid.
6. Allowlist/denylist collapse/expand inside the Auto Execution card.
7. Maintenance time inputs are disabled when the window toggle is off.
8. Keyword input is disabled when log filter is off.
9. Save Policy persists settings.
10. At narrow widths the dual panel and policy grid degrade to single column.

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: polish agent/ai settings redesign"
```

---

## Self-Review

- **Spec coverage:** Component split (Task 2-6), dual-panel layout (Task 4-6), policy 4-card grouping (Task 2-3), data flow via props (Task 6), error handling reuses `message` state (Task 6), testing via build+smoke (Task 8), i18n keys (Task 1). All spec sections covered.
- **Placeholder scan:** The `applyModelPreset` dynamic-import placeholder in Task 6 Step 1 is explicitly flagged and replaced with the static-import version in the same step. No other TBD/TODO.
- **Type consistency:** `onChange(partial: Partial<AgentPolicySettings>)` is uniform across all 4 policy cards and the wrapper. `onSettingsChange(partial: Partial<AiProviderSettings>)` is uniform in `AiConnectionConfig`. Prop names match between container and children.
