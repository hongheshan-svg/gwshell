# Single-Sidebar Navigation — Design (P2 nav restructure)

- 2026-06-07 · 纯前端 · **tsc/build/smoke 验;布局/交互行为用户目测**

## Goal

Collapse the left navigation from **three stacked layers** (icon rail + asset sub-panel + tab bar) to **two** (one sidebar + tab bar), and remove broken/misleading controls. Outcome: less chrome, clearer purpose, every control does something real.

## Current state (problems)

- **Icon rail** (`Sidebar/IconNav.tsx`, the ~44px column): 9 items with inconsistent semantics — some navigate (`assetlist`, `snippets`), some toggle panels (`sessions`, `files`), some open create-modals (`quickconnect`, `docker`, `terminal`), and **two are stubs** (`keys`, `services`) that only `setShowSettings(true)`.
- **Asset sub-panel** (`Sidebar/SessionPanel.tsx`): the session tree, but its header has **5 toolbar icons and only Search has an `onClick`** — `Settings`, `new-folder` (`FolderPlus`), `Copy`, `Link` are **dead buttons** (no handler), i.e. fake affordances.
- The icon rail + sub-panel are two separate columns doing one job (get to a session).

## Target structure

```
┌─────────────────────────┐
│ 资产            [+] [🔍] │  Header: title (→ opens 列表 tab),
├─────────────────────────┤          create menu, search toggle
│ ▾ 分组 A                 │
│   • host1          ●     │  Body: session tree
│   • host2                │        (or snippet list in snippets mode)
│ ▾ 分组 B                 │
│   • host3                │
│                         │
├─────────────────────────┤
│ [片段] [文件] [主题] [≡] │  Footer: snippets toggle · SFTP ·
└─────────────────────────┘          theme · collapse · menu
```

`.app-layout` goes from 3 children (`Sidebar` + panel + `main-content`) to **2** (`sidebar-column` + `main-content`).

## Control mapping (every current control gets a home or is removed)

| Current (icon rail) | New home |
|---|---|
| 快速连接 `quickconnect` | entry in the **`+` create menu** (top) |
| 会话 `sessions` (toggled sidebar) | **collapse** control in footer |
| 资产列表 `assetlist` | sidebar **title** click → `setActiveTab('asset-list')` |
| 文件 `files` (SFTP) | footer **文件** button (contextual to active SSH tab) |
| Docker / 本地终端 | already in the **`+` menu** — removed from rail |
| 片段 `snippets` | footer **片段** toggle (swaps sidebar body) |
| 主题 / 菜单 / 折叠 | sidebar **footer** |
| 密钥 `keys` / 网络服务 `services` | **removed** (were Settings stubs) |

**Also removed:** the 4 dead sub-panel header icons (`Settings`/`FolderPlus`/`Copy`/`Link`). Header becomes `title + [+] + [🔍]`.

## Components

- **`Sidebar/IconNav.tsx`** — **deleted**. App stops rendering it. Its live behaviours move to the footer / `+` menu / sidebar title per the table above.
- **`Sidebar/SidebarFooter.tsx`** — **new**, focused component. Renders the utility row: 片段 toggle (`activeNavItem` ↔ `'snippets'`), 文件/SFTP (`toggleSftpPanel`, contextual), 主题 (`toggleTheme`), 折叠 (`toggleSidebar`), 菜单 (`setShowAppMenu`). Pulls everything from `appStore` (no new state).
- **`Sidebar/SessionPanel.tsx`** — remove the 4 dead header icons; make the title `资产` clickable → `setActiveTab('asset-list')`; the existing `+` menu (`NewAssetMenu`) gains a 快速连接 entry handled in `handleNewAssetSelect` (`setShowQuickConnect(true)`).
- **`Sidebar/NewAssetMenu.tsx`** — add `{ id: 'quickconnect', icon: Zap, labelKey: 'newasset_quickconnect' }` as the first top-level item.
- **`Sidebar/SnippetPanel.tsx`** — unchanged content; just reached via the footer toggle instead of the rail.
- **`App.tsx`** — replace `<Sidebar />` + `{activeNavItem==='snippets' ? <SnippetPanel/> : <SessionPanel/>}` with a single `sidebar-column` wrapper: `{ snippets ? <SnippetPanel/> : <SessionPanel/> }` as the body + `<SidebarFooter/>` at the bottom. When `sidebarCollapsed`, the column hides; an **expand** affordance appears at the left of `TabBar`.
- **`TabBar/TabBar.tsx`** — when `sidebarCollapsed`, show a small panel-open button at its left edge (`toggleSidebar`) so the hidden sidebar can be brought back (the rail used to host this).

## State / behaviour

- `sidebarCollapsed` is reused: collapsing hides the whole sidebar column (not a thin icon strip — that was the rejected variant). Expand via the TabBar button.
- Snippets mode reuses `activeNavItem === 'snippets'`; the footer 片段 button toggles `activeNavItem` between `'snippets'` and `'sessions'` (any non-`'snippets'` value renders `SessionPanel` as the body).
- 列表 (asset-list) tab is assumed **persistent** in the TabBar; the sidebar title also focuses it. (If it can be closed, the title click re-creates/activates it — verify in TabBar.)

## Kept (no regression)

TabBar, the main-area **asset table** (列表 view — richer columns + bulk actions; sidebar tree stays as quick-access), terminals, all modals, SFTP panel, snippet list content.

## Removed / cleanup

- `IconNav.tsx` file; `.icon-navbar` CSS becomes dead (remove).
- Now-unused i18n keys: `nav_keys`, `nav_services`, `panel_settings`, `panel_new_folder`, `panel_copy`, `panel_link` (leave or prune — harmless).
- New i18n keys: `newasset_quickconnect` (both locales).

## Edge cases

- Collapsed + no rail → must keep an expand control reachable (TabBar button). Verify it's always visible when collapsed.
- 文件/SFTP footer button when active tab isn't SSH → no-op (match current `handleNavClick('files')` guard); show disabled/dimmed.
- Switching to snippets then collapsing then expanding → should return to the same body.

## Verification

`npx tsc --noEmit`, `npm run build`, `npm run smoke:check` must pass. Runtime (user): sidebar shows session tree; `+` opens create menu incl. 快速连接; search toggles; footer 片段 swaps to snippets and back; 主题/折叠/菜单/文件 work; collapse hides sidebar and the TabBar expand button restores it; title opens the 列表 tab. Default (non-collapsed) layout has exactly two left-to-right regions.

## Risks

- Pure layout/state rewiring — no terminal I/O or backend touched. Main risk is a stranded control (e.g. no expand path when collapsed) → covered by the TabBar expand button. tsc guards type wiring; the rest is visual (user verifies).
