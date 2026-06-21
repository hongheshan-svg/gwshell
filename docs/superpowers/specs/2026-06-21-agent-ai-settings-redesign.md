# Agent / AI Settings Redesign

## Goal

Redesign the Agent/AI settings page (`agent-ai` nav entry in SettingsModal) from a 670-line monolithic component into a clean, well-grouped layout: a dual-panel AI configuration area plus a policy area organized into four functional cards.

## Problem

The current `AiSettingsSection.tsx` is a single 670-line component with three issues:

1. **Monolithic component** — AI config and policy are intermixed in one file, hard to navigate and maintain.
2. **Policy settings ungrouped** — 14 flat rows of toggles/inputs with no categorization.
3. **Model selection disconnected from config** — the model library table and the connection config panel are visually separated; selecting a model doesn't make the relationship to the config obvious.

## Decisions (validated with user)

1. **Dual-panel layout** — left panel is the model library (card list + group tabs); right panel is status card + connection config + advanced params + action bar. Policy is a separate section below.
2. **Policy grouped into 4 functional cards** — auto analysis / auto execution / maintenance window / alerts & log filter.
3. **Single page** — AI config and policy stay on the same `agent-ai` nav entry; no new nav item in SettingsModal.

## Component Architecture

Split `AiSettingsSection.tsx` into focused components:

```
AiSettingsSection.tsx          (container, ~60 lines)
├── AiModelPicker.tsx          (left panel: model library cards + group tabs)
├── AiConnectionConfig.tsx     (right panel: status card + connection config + advanced params + action bar)
└── AgentPolicySection.tsx     (policy area: 4 functional cards)
    ├── PolicyAutoAnalysis.tsx     (auto analysis)
    ├── PolicyAutoExecution.tsx    (auto execution)
    ├── PolicyMaintenance.tsx      (maintenance window)
    └── PolicyAlerts.tsx           (alerts & log filter)
```

- `AiSettingsSection` is the container: loads settings/policy, holds `busy` state, distributes data to children via props. No more 670-line JSX.
- Each policy card is an independent component receiving `policy` and `onChange`. Cards don't depend on each other; each can be understood in isolation.
- Shared state (`settings`, `apiKey`, `busy`, `message`) stays in the container, passed down via props. No new store introduced; reuses existing `useAgentPolicyStore`.
- IPC calls (load/save/test/clear) remain centralized in the container. Child components only fire callbacks; they do not invoke IPC directly.

**Why `AiConnectionConfig` isn't split further:** the status card and connection config share the same `settings` state and save/test actions. Splitting them would require passing many props and callbacks back and forth with little benefit. Keeping `AiConnectionConfig` as one component is a reasonable boundary.

## Dual-Panel Layout

`AiSettingsSection` renders two parts: the AI dual-panel on top, the policy section below.

### Left panel: `AiModelPicker`

- Top: group tabs (国内 / OpenAI / Anthropic / 本地), reusing existing `modelTabs` logic, default `china`.
- Below: model card list. Each card shows: vendor + model name + one-line scene description + badge. Selected state uses accent border + background highlight.
- Cards replace the current 5-column table (`ai-model-list`). The table squeezes badly at small widths; cards adapt better.
- Click a card → `applyModelPreset`, fills the right-side config.

### Right panel: `AiConnectionConfig`

- Top: status card — current model name + status badge (ready / disabled / key missing / incomplete) + enable toggle. Reuses existing `status` logic.
- Connection config: Base URL / Model / API Key fields + key status hint. The `providerDefaults` segmented buttons stay but collapse to a compact single row.
- Advanced params (timeout / max input / temperature): collapsed by default, click to expand. Currently always flat; folding reduces visual noise.
- Bottom: action bar — Clear Key / Test / Save. Keeps the existing three buttons.
- Error/success messages show below the status card.

### Responsive

At `max-width: 820px`, the dual panel degrades to a single column (picker on top, config below), reusing the existing media query breakpoint.

## Policy Section: 4 Cards

`AgentPolicySection` sits below the AI dual-panel, arranged as a 2×2 grid (degrades to single column on narrow screens).

### Card 1: Auto Analysis (`PolicyAutoAnalysis`)

- Auto-continue analysis (toggle)
- Live log auto-analysis (toggle)
- Max auto-continuations (number, 1-30)

### Card 2: Auto Execution (`PolicyAutoExecution`)

- Auto-execute read-only commands (toggle)
- Auto-execute low-risk commands (toggle)
- Command allowlist (textarea, one per line) — collapsed by default, click to expand
- Service denylist (textarea, one per line) — collapsed by default, click to expand

### Card 3: Maintenance Window (`PolicyMaintenance`)

- Enable maintenance window (toggle)
- Time range (two time inputs: start — end) — editable only when enabled

### Card 4: Alerts & Log Filter (`PolicyAlerts`)

- Log keyword filter (toggle)
- Keyword list (input, comma-separated) — editable only when filter enabled
- Disk alert threshold (number, 1-100, with `%` suffix)
- Memory alert threshold (number, 1-100, with `%` suffix)

**Key points:**

- Each card has its own title (icon + text), rendered as a bordered rounded block. Visually extends the existing `.agent-policy-controls` language but upgrades to a card container.
- A single save button sits at the bottom of the policy section (same as current, not repeated per card). Policy `busy` is shared with the AI area; the whole page disables during save.
- Allowlist/denylist textareas collapsed by default: they are always flat now and take space, but most users rarely edit them. Folding keeps cards compact.
- Maintenance window time inputs: when `maintenance_window_enabled` is off, the time inputs are disabled (greyed out), preventing users from editing a non-effective config.
- Keyword list: when `log_filter_enabled` is off, the keyword input is disabled.

## Data Flow

Container `AiSettingsSection` holds all state, passed down one-way via props:

```
AiSettingsSection (state: settings, apiKey, policy, busy, message)
  │
  ├─ AiModelPicker        props: presets, activePreset, onApply(presetId), busy
  ├─ AiConnectionConfig   props: settings, apiKey, status, onChange(partial), onApiKeyChange, busy, message
  │                       actions: onSave, onTest, onClearKey
  └─ AgentPolicySection   props: policy, busy, message
       ├─ PolicyAutoAnalysis     props: policy, busy, onChange(partial)
       ├─ PolicyAutoExecution    props: policy, busy, onChange(partial)
       ├─ PolicyMaintenance      props: policy, busy, onChange(partial)
       └─ PolicyAlerts           props: policy, busy, onChange(partial)
```

- Policy cards use a uniform `onChange(partial: Partial<AgentPolicySettings>)`; the container merges: `setPolicy({ ...policy, ...partial })`. A card doesn't need to know the full policy shape, only the fields it owns.
- AI config uses `onChange(partial: Partial<AiProviderSettings>)` the same way.
- No new store. Reuses `useAgentPolicyStore` (policy load/save already there); AI settings keep local state + invoke (same as current).

## Error Handling

- Reuses the existing `message` state (`{ area: 'ai' | 'policy', kind: 'ok' | 'err', text }`). The AI area and policy area each show their own messages without interference.
- IPC calls (save/test/clear/load) keep their try/catch in the container; errors become `message` passed down.
- Input validation keeps current logic (`normalizedSettings` clamp/trim, policy min/max bounds).

## Testing

- No new backend logic; Rust side unchanged. Existing 162 tests unaffected.
- Frontend: `npm run build` (tsc strict + noUnusedLocals) serves as type and unused-code check.
- `npm run smoke:check`: verifies the invoke command registry is unchanged (49 frontend invokes / 83 backend commands). Splitting components does not add or remove IPC calls.
- Manual: open Settings → Agent/AI, confirm model selection, config save/test, and policy 4-card save all work.

## i18n

- Reuses all existing `agent_ai_*` and `agent_policy_*` keys. The four card titles can use existing keys or existing labels.
- If card titles need new copy, add a small number of keys to both EN and ZH locales.

## Files

- Modify: `src/components/Settings/AiSettingsSection.tsx` (becomes the slim container).
- Create: `src/components/Settings/AiModelPicker.tsx`
- Create: `src/components/Settings/AiConnectionConfig.tsx`
- Create: `src/components/Settings/AgentPolicySection.tsx`
- Create: `src/components/Settings/policy/PolicyAutoAnalysis.tsx`
- Create: `src/components/Settings/policy/PolicyAutoExecution.tsx`
- Create: `src/components/Settings/policy/PolicyMaintenance.tsx`
- Create: `src/components/Settings/policy/PolicyAlerts.tsx`
- Modify: `src/styles/global.css` (new card/grid styles, keep existing token usage).
- Modify: `src/i18n/locales/gwshell.en.json` and `src/i18n/locales/gwshell.zh.json` (only if new card-title keys are needed).

## Self-Review

- **Spec coverage:** covers component split, dual-panel layout, policy 4-card grouping, data flow, error handling, testing, i18n.
- **Placeholder scan:** no TBD/TODO placeholders.
- **Internal consistency:** data flow matches component architecture; props match the described responsibilities.
- **Scope check:** focused on one settings page redesign, single implementation plan.
- **Type consistency:** `onChange(partial)` pattern is uniform across all policy cards and AI config.
