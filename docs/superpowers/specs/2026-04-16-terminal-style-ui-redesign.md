# Terminal-Style UI Redesign

**Date:** 2026-04-16
**Status:** Draft
**Scope:** Full visual overhaul — colors, fonts, geometry, component styling, animations, layout proportions

## Goal

Transform GWShell's UI from its current modern-app aesthetic (rounded corners, gradients, soft shadows) into a **modern dark terminal style** inspired by Windows Terminal and VS Code's integrated terminal. Both dark and light themes must be preserved, each carrying a terminal-native feel.

## Design Principles

1. **Monospace everywhere** — all UI text uses a monospace font, not just the terminal
2. **Sharp geometry** — 0-2px border-radius maximum; no rounded pills, no soft curves
3. **Flat surfaces** — no gradients, no box-shadows for depth; rely on borders and subtle background-color shifts
4. **Terminal color palette** — green/yellow/red/cyan from classic terminal conventions, not arbitrary accent colors
5. **Dense & compact** — tighter padding, smaller gaps, higher information density
6. **Fast transitions** — 80-120ms linear transitions; no bouncy/elastic animations

## Color System

### Dark Theme (default)

```
Background layers (darkest → lightest):
  --bg-primary:    #0c0c14     (main terminal area)
  --bg-secondary:  #12121c     (panels, sidebars, headers)
  --bg-tertiary:   #1a1a28     (elevated surfaces: toolbar, table header)
  --bg-hover:      #222233     (hover state)
  --bg-active:     #2a2a3d     (active/selected state)
  --bg-card:       #14141e     (cards if any)

Borders:
  --border-color:  #2a2a3d     (primary dividers)
  --border-light:  #333348     (subtle separators)

Text:
  --text-primary:  #d4d4d8     (main text — slightly warm gray, not pure white)
  --text-secondary:#8888a0     (labels, descriptions)
  --text-muted:    #555570     (placeholders, disabled)

Accent (terminal cyan-blue):
  --accent-primary:     #5ac8fa
  --accent-primary-rgb: 90, 200, 250
  --accent-hover:       #7dd6fc
  --accent-bg:          rgba(90, 200, 250, 0.10)

Semantic:
  --success:     #50fa7b   (connected / OK — terminal green)
  --success-rgb: 80, 250, 123
  --warning:     #f1fa8c   (caution — terminal yellow)
  --warning-rgb: 241, 250, 140
  --danger:      #ff5555   (error / disconnect — terminal red)
  --danger-rgb:  255, 85, 85
```

### Light Theme

```
Background layers:
  --bg-primary:    #f0f0f4     (main area — cool gray, not white)
  --bg-secondary:  #e8e8ee     (panels)
  --bg-tertiary:   #dddde6     (elevated)
  --bg-hover:      #d0d0dc     (hover)
  --bg-active:     #c8c8d6     (active)
  --bg-card:       #eaeaf0

Borders:
  --border-color:  #c0c0cc
  --border-light:  #d0d0dc

Text:
  --text-primary:  #1a1a2e
  --text-secondary:#555570
  --text-muted:    #8888a0

Accent:
  --accent-primary:     #0078d4   (slightly deeper blue for readability on light bg)
  --accent-primary-rgb: 0, 120, 212
  --accent-hover:       #006abc
  --accent-bg:          rgba(0, 120, 212, 0.08)

Semantic (darker versions for light bg):
  --success:     #16a34a
  --success-rgb: 22, 163, 74
  --warning:     #ca8a04
  --warning-rgb: 202, 138, 4
  --danger:      #dc2626
  --danger-rgb:  220, 38, 38
```

## Typography

```
--font-mono: 'Cascadia Mono', 'JetBrains Mono', 'Consolas', 'Fira Code', monospace
--font-sans: var(--font-mono)   /* UI text = monospace too */
```

Global font size stays at 13px. Line heights tightened from 24px to 20px.

## Geometry & Spacing

```
--radius-sm: 1px
--radius-md: 2px
--radius-lg: 2px

--shadow-sm: none
--shadow-md: 0 2px 8px rgba(0, 0, 0, 0.3)    (only for floating menus/dropdowns)
--shadow-lg: 0 4px 16px rgba(0, 0, 0, 0.4)    (only for modals)
```

Light theme shadows use lower opacity (0.1 / 0.15).

## Component-by-Component Changes

### TitleBar
- Height stays 32px
- Background: `--bg-secondary`, no gradient
- Title text: monospace, `font-weight: 500` (not 600)
- Window control buttons: square (no border-radius), wider hover area
- Close button hover: `--danger` background

### Icon Navbar (Left Sidebar)
- Width stays 48px
- Nav button: square shape (`border-radius: 1px`)
- Active indicator: replace the rounded left-bar with a flat 2px-wide `border-left` directly on the button (no `::before` pseudo-element)
- Active color: `--accent-primary` background tint
- Logo icon top: simpler, no special margin

### Session Panel
- Header padding tightened: `4px 8px`
- Search input: `border-radius: 1px`, no focus glow — just `border-color` change on focus
- Session items: remove `linear-gradient` from active state, use flat `--bg-active` + `border-left: 2px solid --accent-primary`
- Group count badge: square (`border-radius: 1px`), not pill
- Collapse toggle: same width (16px), square

### TabBar
- Height: reduce from 38px to 32px
- Tab items: no border-radius, no gradient on active
- Active tab: flat `--bg-active` background + 2px bottom border in `--accent-primary` (remove `::after` with absolute positioning — use direct `border-bottom` instead)
- Tab close button: square, no border-radius
- Add button: solid border (not dashed), square
- Connection dot: keep as-is (small circle indicators are universal)

### Terminal Container
- Remove `radial-gradient` background overlay — use flat `--bg-primary`
- Split pane focused border: solid 1px `--accent-primary`, no `box-shadow`
- Split pane header: flat `--bg-secondary`, no gradient

### StatusBar
- Height stays 26px
- Status items: `border-radius: 1px`
- Split picker menu: square corners (`border-radius: 2px`)
- Connection dots: keep circular (standard convention)

### Modals
- `border-radius: 2px` (not 8px)
- Remove `backdrop-filter: blur(4px)` from overlay — use solid `rgba(0,0,0,0.65)`
- Modal header: tighter padding `12px 16px`
- Form inputs: `border-radius: 1px`, no focus glow — just border-color change
- Auth toggle buttons: square (`border-radius: 2px`), not pills (`border-radius: 15px`)
- Buttons (.btn): `border-radius: 1px`
- Primary button: use `--accent-primary`, keep solid

### Context Menus / Dropdowns
- `border-radius: 2px`
- Menu items: `border-radius: 1px`
- Keep current hover coloring pattern

### SFTP Panel
- Folder icon: remove `drop-shadow` filter
- File items: same styling approach, tighter padding
- Path display: `border-radius: 1px`
- Chmod dialog: `border-radius: 2px`

### SFTP Editor
- Dialog: `border-radius: 2px`
- Editor header background: flat `--bg-tertiary`, no gradient implied
- Save button: stays accent-colored

### Asset Table
- Search box: `border-radius: 1px`, no focus glow
- Table rows selected: flat background, `box-shadow: inset 2px 0 0` stays (it's a good left-indicator)
- Toolbar buttons: square

### Scrollbar
- Track: transparent
- Thumb: `border-radius: 1px` (nearly square), color `--border-light`
- Width: keep 6px

### Quick Action Cards (Terminal Placeholder)
- Remove `transform: translateY(-1px)` on hover
- Square corners
- No `box-shadow` on hover — use border-color change only
- Placeholder logo box: `border-radius: 2px` (not 16px)

## Animation Changes

All `transition` values:
- Duration: `0.1s` (from various 0.12s-0.25s)
- Timing: `linear` (from `ease`)
- No `transform` animations (no translateY, no scale on hover for color dots)

Exception: sidebar collapse (`width` transition) keeps `0.15s` for smoothness.

## What Does NOT Change

- React component structure and hierarchy
- State management (Zustand stores)
- Business logic, IPC calls, event patterns
- Layout structure (sidebar + tabs + terminal + statusbar)
- Icon library (Lucide)
- i18n system
- xterm.js terminal appearance (it has its own theme config separate from CSS)

## Implementation Strategy

All changes are in `src/styles/global.css` — the single CSS file that contains all styling. No component TSX files need changes since all visual properties are controlled through CSS classes and CSS variables.

**Order of work:**
1. CSS variables (`:root` and `[data-theme='light']`) — establishes the new palette and geometry tokens
2. Global resets (scrollbar, font) — applies monospace globally
3. Layout sections top-to-bottom: TitleBar → Navbar → Sidebar → TabBar → Terminal → StatusBar
4. Floating elements: Modals → Context menus → Dropdowns
5. Feature panels: SFTP → Editor → Asset Table
6. Quick action cards, type tags, misc

## Files Modified

- `src/styles/global.css` — primary target, all CSS changes
- `src/App.css` — update `:root` font and button border-radius to match
