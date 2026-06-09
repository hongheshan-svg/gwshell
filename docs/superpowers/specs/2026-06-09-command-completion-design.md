# Command Completion Dropdown — Design

Date: 2026-06-09
Status: Approved (design), pending spec review

## Goal

Replace GWShell's current inline ghost-text command hint with a cursor-anchored
**completion dropdown** modeled on the HexHub reference: a popup that lists
candidate commands as the user types, each row showing an icon, the command
name, and a short description. Candidates come from two sources merged together:

1. A built-in dictionary of common shell commands (with descriptions).
2. The user's command history (existing behavior).

## Current state (what we're changing)

- `src/lib/commandHistory.ts` — `getSuggestions(prefix, ctx)` returns up to 8
  ranked **full-command** strings, sourced **only from history** (commands the
  user has previously typed). Ranking: `log2(count+1) * recencyDecay`, with
  bonuses for matching scope (+2) and cwd (+1).
- `src/components/Terminal/TerminalView.tsx`:
  - Per-tab maps outside React: `inputBuffers`, `ghostTextState`,
    `ghostTextSetters`, `tabCandidates`, `candidateIndex`,
    `ghostAcceptCallbacks`.
  - `onData` handler (~line 1060) tracks the current input line into
    `inputBuffers`, and `showGhost()`/`clearGhost()` compute the single best
    suffix and push it to the overlay via `ghostTextSetters`.
  - The overlay is a React state pair (`ghostText`, `ghostCursor`) rendered as a
    sibling of the terminal pane, positioned from the xterm buffer
    `cursorX`/`cursorY`.
  - `attachCustomKeyEventHandler` (~line 685) accepts the ghost on `Tab`/`→` and
    cycles candidates on `↑`/`↓`/`Ctrl-N`/`Ctrl-P`.
- Settings gates (unchanged): `terminalCmdHint` (master toggle, read in the
  component), `sshHistoryCmd` (capture), `cmdHintAllSessions`,
  `cmdHintScopeByHost`, `cmdHintDeferToRemote`.

The constraint repeatedly noted in `TerminalView.tsx`: **only one set of event
listeners per tab id**. The design reuses the existing single handler rather
than adding a parallel one.

## Decisions (from clarification)

- **Direction:** full alignment with the reference — dropdown + built-in
  dictionary (with descriptions) + history, merged.
- **Dictionary:** ~120 common Linux/shell commands; descriptions **bilingual**
  (en/zh), selected by the app locale. Stored in a dedicated data file, not in
  the i18n translation JSON.
- **Interaction:** **smart Enter** (see Keybindings).
- **Inline ghost text:** removed; the dropdown replaces it (the reference is a
  pure dropdown).

## Architecture (Approach A — extend existing overlay machinery)

### New: `src/lib/commandDictionary.ts`

- Data: array of `{ cmd: string; en: string; zh: string }`, ~120 entries.
- `lookupCommands(prefix: string, locale: 'en' | 'zh'): { cmd: string; desc: string }[]`
  - Prefix-matches **on the command name only** (the first whitespace-delimited
    token of the line). Returns matches sorted by: exact-prefix then
    alphabetical. Empty result if `prefix` contains whitespace (we're past the
    command name — see merging rules).

### New unified candidate type

```ts
type Completion = {
  text: string;        // full text to complete to (replaces the current line)
  kind: 'history' | 'command';
  desc?: string;       // localized description (command kind only)
};
```

A small merge function (in `commandHistory.ts` or a new
`src/lib/completion.ts`) produces the ranked `Completion[]` (max 8):

- If the current line has **no whitespace** (typing the command name):
  - History matches first (existing `getSuggestions` ranking), `kind:'history'`.
  - Then dictionary matches via `lookupCommands`, `kind:'command'`, **excluding**
    any whose `cmd` already appears as a history match (dedupe).
- If the line **contains whitespace** (typing arguments):
  - History full-line prefix matches only. Dictionary is not consulted
    (no argument/flag data).
- Cap at 8 total.

### New: `<CompletionDropdown>` overlay component

- Rendered as a sibling of the terminal pane (same place the ghost overlay lived).
- Props: `items: Completion[]`, `selectedIndex: number`, anchor `x`/`y` (cursor
  cell → pixel, reusing the existing positioning math), and `visible`.
- Layout per row: leading icon (history → clock icon; command → terminal/`>`
  icon, reusing the app's existing icon set), command name in the terminal
  monospace font, description in a muted color on the right. Selected row
  highlighted.
- Positioning: anchored just below the cursor cell; flips above the cursor when
  near the viewport bottom. Width clamped; long descriptions truncate with
  ellipsis.
- Theming: light/dark via the existing `theme` from the app store and CSS
  variables already in `src/styles/global.css`.

### Reused state (per tab)

- `inputBuffers` — current line (already maintained).
- `tabCandidates` — repurposed to hold `Completion[]`.
- `candidateIndex` — the selected row index.
- A new `userNavigated` flag per tab (set when `↑/↓` moves selection; reset when
  the dropdown (re)opens, the buffer changes, or the dropdown closes).
- The overlay setter (replacing `ghostTextSetters`) becomes
  `(items, selectedIndex, x, y) => void`.

## Data flow

1. `onData` updates `inputBuffers[tab]` on each keystroke (existing logic).
2. After the buffer changes, compute `Completion[]` via the merge function and
   push to the dropdown setter; reset `candidateIndex = 0` and
   `userNavigated = false`. Empty list → hide dropdown.
3. `cmdHintDeferToRemote` + OSC 133 still suppresses the dropdown (unchanged).
4. Key handling in `attachCustomKeyEventHandler` drives selection/accept.

## Keybindings (smart Enter), dropdown open

- `↑` / `↓` — move selection; `preventDefault` (not sent to the shell); set
  `userNavigated = true`.
- `Tab` / `→` — accept the highlighted item (insert the completion suffix into
  the line, send to shell input), close dropdown.
- `Esc` — close the dropdown; key not sent to shell.
- `Enter`:
  - If `userNavigated` is true → accept the highlighted item, close dropdown,
    **do not execute** (`return false`, so xterm `onData` never sees the Enter).
  - Else → let Enter pass to the shell (execute the line) and close the dropdown.
- When the dropdown is **closed**, all keys behave exactly as today (e.g. `↑/↓`
  reach the shell as history navigation).

## Trigger & gating (unchanged)

- Active only for interactive sessions (`ssh`, `localshell`, `serial`,
  `docker`) under the existing gates: `terminalCmdHint` master toggle,
  `sshHistoryCmd` capture, `cmdHintAllSessions`, `cmdHintScopeByHost`,
  `cmdHintDeferToRemote`.

## Non-goals (YAGNI)

- No argument/sub-command/flag completion (e.g. completing `git <subcommand>` or
  `ls -<flag>`). Only command-name dictionary + full-line history.
- No fuzzy matching — prefix match only (matches current behavior).
- No remote/server-side completion (Tab still passes through to the shell when
  the dropdown is closed; only intercepted while open).
- No new persisted settings beyond the existing toggles.

## Files

- **New:** `src/lib/commandDictionary.ts` (~120 entries + `lookupCommands`).
- **New:** `src/lib/completion.ts` (merge/rank) — or extend `commandHistory.ts`.
- **New:** `<CompletionDropdown>` component (file under
  `src/components/Terminal/`).
- **Modify:** `src/components/Terminal/TerminalView.tsx` — replace ghost overlay
  setter + state with the dropdown; extend the key handler for navigation/accept/
  smart-Enter; reset `userNavigated`.
- **Modify:** `src/styles/global.css` — dropdown styles (reuse existing theme
  variables).
- Possibly remove now-dead inline ghost-text rendering.

## Testing

- No automated test suite exists. Run `npm run smoke:check` for static issues.
- `npm run build` for TypeScript type-check.
- Manual verification in `npm run tauri dev`:
  - Fresh SSH session (no history): typing `l` shows dictionary entries
    (`ls`, `ln`, `lsof`, `lscpu`, `lsblk`, `locate`, …) with descriptions.
  - After running some commands: history entries appear first with the clock
    icon, deduped against dictionary.
  - `↑/↓` navigates; `Tab`/`→` accepts; `Esc` dismisses; `Enter` without
    navigating executes; `Enter` after navigating accepts without executing.
  - Dropdown closed: `↑/↓` still drive shell history.
  - Light/dark theme both render correctly; dropdown flips near viewport bottom.
