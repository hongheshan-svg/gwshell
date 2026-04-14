# AI Section UI Redesign — CC Switch Style

**Date:** 2026-04-14  
**Status:** Approved

## Goal

Redesign the gwshell AI section navigation and provider cards to match the visual language of CC Switch: icon-only app switcher, compact toolbar, circle provider avatars, no gradient overlays.

## Design

### Toolbar (replaces text tab bar)

A single fixed-height row at the top of the AI section replaces the current scrollable text tab bar and the inline AppSwitcher + bottom add-bar.

Layout (left → right):
1. **App switcher pill group** — icon-only buttons for Claude / Codex / Gemini / OpenCode / OpenClaw. Active app gets white background + shadow; inactive apps are flat icons.
2. **Spacer** (flex-1)
3. **Action icon pill group** — four icon buttons: MCP, Skills, Agents, Usage. Clicking switches to that panel. Active icon gets white background + shadow inside the pill.
4. **Settings gear icon** — standalone icon button that switches to the Settings panel. Also serves as the entry point for Proxy, Workspace, Prompts, Auth, Sessions (those views are reached from within Settings, or the gear cycles to them — exact sub-navigation handled by the existing SettingsPanel).
5. **Add button** — orange filled circle with `+`, triggers AddProviderDialog (only visible/relevant when on the providers view).

### Provider Cards

- **Avatar shape:** `rounded-full` (circle) instead of `rounded-lg` (square).
- **Avatar content:** Uses existing `ProviderIcon` component but rendered inside a circle container with a solid colored background. The color comes from `provider.iconColor` if set, otherwise derives a deterministic color from the provider name.
- **Remove gradient overlay:** The `absolute inset-0 bg-gradient-to-r` overlay div is removed entirely.
- **Active highlight:** Keep the blue border (`border-blue-500/60`) and the subtle `bg-blue-50` background tint — but no gradient.
- **Card structure:** Unchanged otherwise (drag handle, name, URL, health indicator, hover actions).

### Navigation mapping

| Panel | Access point |
|-------|-------------|
| Providers | App switcher (always shows providers for the selected app) |
| MCP | Right icon group |
| Skills | Right icon group |
| Agents | Right icon group |
| Usage | Right icon group |
| Settings | Gear icon |
| Proxy | Via Settings |
| Workspace | Via Settings |
| Prompts | Via Settings |
| Auth | Via Settings |
| Sessions | Via Settings |

### Files to change

| File | Change |
|------|--------|
| `src/components/ai/AiSection.tsx` | Replace tab bar with new `AiToolbar` component; lift view state and pass to toolbar |
| `src/components/ai/AiProviders.tsx` | Remove bottom add-bar; receive `onAdd` callback from parent toolbar |
| `src/components/ai/providers/AppSwitcher.tsx` | Add `iconOnly` prop (default true in new usage); hide text labels when set |
| `src/components/ai/providers/ProviderCard.tsx` | Change avatar to circle; remove gradient overlay div |
| New: `src/components/ai/AiToolbar.tsx` | New component encapsulating the toolbar layout |

### AiToolbar component

```
<AiToolbar
  activeView={view}          // 'providers' | 'mcp' | 'skills' | 'agents' | 'usage' | 'settings'
  activeApp={activeApp}      // AppId — only relevant for providers view
  onViewChange={setView}
  onAppChange={setActiveApp}
  onAdd={() => setAddOpen(true)}  // only active on providers view
/>
```

The toolbar owns its own rendering; `AiSection` passes callbacks down.

## Out of Scope

- Dark mode adjustments (existing dark mode classes carry over).
- Reordering which panels exist or their content.
- Any changes to forms, dialogs, or panel internals.
