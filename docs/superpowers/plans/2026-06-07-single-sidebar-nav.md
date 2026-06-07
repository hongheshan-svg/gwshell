# Single-Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 3-layer left nav (icon rail + asset sub-panel + tab bar) into a single sidebar + tab bar, removing dead/stub controls.

**Architecture:** Delete `IconNav.tsx`; fold its live functions into a new `SidebarFooter` (snippets-toggle, theme, collapse, menu), the existing `+` create menu (gains 快速连接), and the sidebar title (opens 列表 tab). App renders one `.sidebar-column` (body panel + footer) instead of two columns. SFTP stays in the TabBar (already contextual). When collapsed, a TabBar button re-opens the sidebar.

**Tech Stack:** React + TypeScript, Zustand (`appStore`), lucide-react icons, i18next. No automated tests in this repo — each task is gated on `npx tsc --noEmit` + `npm run build` + `npm run smoke:check`, with a final user visual check.

Spec: `docs/superpowers/specs/2026-06-07-single-sidebar-nav-design.md`

---

### Task 1: Add 快速连接 to the `+` create menu

**Files:**
- Modify: `src/i18n/locales/gwshell.en.json`, `src/i18n/locales/gwshell.zh.json`
- Modify: `src/components/Sidebar/NewAssetMenu.tsx`
- Modify: `src/components/Sidebar/SessionPanel.tsx`, `src/components/TabBar/TabBar.tsx` (both consume the menu)

- [ ] **Step 1: Add the i18n key** after `newasset_ssh` in both locales.

`gwshell.en.json` — find `"newasset_ssh": "SSH",` and add below it:
```json
  "newasset_quickconnect": "Quick Connect",
```
`gwshell.zh.json` — find `"newasset_ssh": "SSH",` and add below it:
```json
  "newasset_quickconnect": "快速连接",
```
(If `newasset_ssh` is not a standalone line, instead add the key anywhere inside the top-level object near the other `newasset_*` keys.)

- [ ] **Step 2: Add the menu entry.** In `NewAssetMenu.tsx`, add `Zap` to the lucide import and add the item as the **first** `menuItems` entry:

Import line becomes:
```ts
import {
  TerminalSquare,
  Box,
  Monitor,
  ChevronRight,
  Network,
  Usb,
  Server,
  Zap,
} from 'lucide-react';
```
`menuItems` becomes:
```ts
const menuItems: { id: string; icon: typeof TerminalSquare; labelKey: TranslationKeys; hasSubmenu?: boolean; disabled?: boolean }[] = [
  { id: 'quickconnect', icon: Zap, labelKey: 'newasset_quickconnect' },
  { id: 'ssh', icon: Server, labelKey: 'newasset_ssh' },
  { id: 'localshell', icon: TerminalSquare, labelKey: 'newasset_localshell' },
  { id: 'docker', icon: Box, labelKey: 'newasset_docker' },
  { id: 'remote', icon: Monitor, labelKey: 'newasset_remote', hasSubmenu: true },
];
```

- [ ] **Step 3: Handle `quickconnect` in `SessionPanel.tsx`.** Add `setShowQuickConnect` to the store destructure (line ~25) and a branch at the top of `handleNewAssetSelect`:
```ts
  const handleNewAssetSelect = (type: string) => {
    if (type === 'quickconnect') { setShowQuickConnect(true); return; }
    if (supportedQuickCreateTypes.has(type)) {
      setShowNewSession(true);
    } else if (type === 'serial') {
      setShowSerialModal(true);
    } else if (type === 'docker') {
      setShowDockerModal(true);
    } else if (type === 'localshell') {
      setShowLocalTerminalModal(true);
    }
  };
```
Destructure (add `setShowQuickConnect`):
```ts
  const { sessions, sidebarCollapsed, setShowNewSession, setShowQuickConnect, setShowDockerModal, setShowLocalTerminalModal, setShowSerialModal, setEditingSession, addSession, removeSession, tabs, addTab, setActiveTab, setGroupDefaultsTarget } = useAppStore();
```

- [ ] **Step 4: Handle `quickconnect` in `TabBar.tsx`.** Add `setShowQuickConnect` to its destructure (line 8) and the same branch in its `handleNewAssetSelect`:
```ts
  const handleNewAssetSelect = (type: string) => {
    if (type === 'quickconnect') { setShowQuickConnect(true); return; }
    if (supportedQuickCreateTypes.has(type)) {
      setShowNewSession(true);
    } else if (type === 'serial') {
      setShowSerialModal(true);
    } else if (type === 'docker') {
      setShowDockerModal(true);
    } else if (type === 'localshell') {
      setShowLocalTerminalModal(true);
    }
  };
```
Add `setShowQuickConnect` to the `useAppStore()` destructure on line 8.

- [ ] **Step 5: Verify.** Run `npx tsc --noEmit` (Expected: exit 0). Run `npm run smoke:check` (Expected: `Result: PASS`).

- [ ] **Step 6: Commit.**
```bash
git add src/i18n/locales/gwshell.en.json src/i18n/locales/gwshell.zh.json src/components/Sidebar/NewAssetMenu.tsx src/components/Sidebar/SessionPanel.tsx src/components/TabBar/TabBar.tsx
git commit -m "feat(nav): add Quick Connect to the + create menu"
```

---

### Task 2: Create `SidebarFooter` component

**Files:**
- Create: `src/components/Sidebar/SidebarFooter.tsx`

- [ ] **Step 1: Write the component.** It renders the utility row absorbed from the old icon rail: snippets-toggle, theme, collapse, menu. All state comes from `appStore`.
```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Sun, Moon, PanelLeftClose, MoreVertical } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

/**
 * Footer of the single sidebar. Holds the utility controls that used to live in
 * the (now-removed) icon rail: snippets toggle, theme, collapse, and the app menu.
 * SFTP intentionally stays in the TabBar (it is contextual to an SSH tab).
 */
export const SidebarFooter: React.FC = () => {
  const { t } = useTranslation();
  const { theme, toggleTheme, toggleSidebar, activeNavItem, setActiveNavItem, showAppMenu, setShowAppMenu } = useAppStore();
  const snippetsActive = activeNavItem === 'snippets';

  return (
    <div className="sidebar-footer">
      <button
        className={`nav-icon-btn ${snippetsActive ? 'active' : ''}`}
        onClick={() => setActiveNavItem(snippetsActive ? 'sessions' : 'snippets')}
        title={t('nav_snippets')}
      >
        <Code size={18} />
      </button>
      <button className="nav-icon-btn" onClick={toggleTheme} title={t('nav_toggle_theme')}>
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <div style={{ flex: 1 }} />
      <button className="nav-icon-btn" onClick={toggleSidebar} title={t('nav_toggle_sidebar')}>
        <PanelLeftClose size={18} />
      </button>
      <button
        className={`nav-icon-btn ${showAppMenu ? 'active' : ''}`}
        onClick={() => setShowAppMenu(!showAppMenu)}
        title={t('nav_menu')}
      >
        <MoreVertical size={18} />
      </button>
    </div>
  );
};
```

- [ ] **Step 2: Verify it compiles.** Run `npx tsc --noEmit` (Expected: exit 0 — the component is unused for now, which is fine).

- [ ] **Step 3: Commit.**
```bash
git add src/components/Sidebar/SidebarFooter.tsx
git commit -m "feat(nav): add SidebarFooter (snippets/theme/collapse/menu)"
```

---

### Task 3: Add sidebar-column + footer CSS

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add the column/footer/title styles.** Append after the `.sidebar-panel` block (anchor on the existing `.sidebar-panel {` rule near line 261; add the new rules just before it or after its closing brace). The column owns the width + border; the body panel fills it; the footer pins to the bottom.
```css
/* Single sidebar = body panel (SessionPanel/SnippetPanel) + SidebarFooter. */
.sidebar-column {
  width: var(--sidebar-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  overflow: hidden;
}
.sidebar-column > .sidebar-panel,
.sidebar-column > .snippet-panel {
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  border-right: none;
}
.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}
.sidebar-title-link {
  cursor: pointer;
}
.sidebar-title-link:hover {
  color: var(--text-primary);
}
```

- [ ] **Step 2: Verify.** Run `npm run build` (Expected: `built in …` success — CSS is bundled).

- [ ] **Step 3: Commit.**
```bash
git add src/styles/global.css
git commit -m "style(nav): sidebar-column + footer + clickable title styles"
```

---

### Task 4: Clean the SessionPanel header (remove dead icons, title → 列表 tab)

**Files:**
- Modify: `src/components/Sidebar/SessionPanel.tsx`

- [ ] **Step 1: Remove the 4 dead toolbar icons and make the title open the asset-list tab.** Replace the `sidebar-header-row` block (lines ~119-139):
```tsx
        <div className="sidebar-header-row">
          <h3 className="sidebar-title-link" onClick={() => setActiveTab('asset-list')} title={t('nav_assetlist')}>{t('panel_asset_list')}</h3>
          <button className="sidebar-action-btn" onClick={() => setShowSearch(!showSearch)} title={t('panel_search')}>
            <Search size={13} />
          </button>
        </div>
```
This deletes the entire `<div className="sidebar-actions">…</div>` (the Settings / FolderPlus / Copy / Link buttons).

- [ ] **Step 2: Drop the now-unused imports.** In the lucide import block, remove `FolderPlus` and `Link` (keep `Settings` — still used by the group-defaults button at line ~204; keep `Copy` — still used by the context menu at line ~242). The import becomes:
```tsx
import {
  ChevronRight,
  ChevronDown,
  Monitor,
  Plus,
  Search,
  Server,
  FolderOpen,
  Folder,
  Settings,
  Copy,
  Play,
  Edit,
  Trash2,
} from 'lucide-react';
```

- [ ] **Step 3: Verify.** Run `npx tsc --noEmit` (Expected: exit 0, no "declared but never used" errors for FolderPlus/Link).

- [ ] **Step 4: Commit.**
```bash
git add src/components/Sidebar/SessionPanel.tsx
git commit -m "feat(nav): remove dead sub-panel toolbar icons; title opens 列表 tab"
```

---

### Task 5: Switch App.tsx to the single sidebar-column

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Swap the import.** Remove the IconNav import (line 5) and add SidebarFooter:
```tsx
// delete:  import { Sidebar } from './components/Sidebar/IconNav';
import { SidebarFooter } from './components/Sidebar/SidebarFooter';
```

- [ ] **Step 2: Add `sidebarCollapsed` to the store destructure.** In the `useAppStore()` destructure (lines 45-51), add `sidebarCollapsed`:
```tsx
  const { theme, setSessions, tabs, activeTabId, sftpPanelOpen, sessions,
    showNewSession, showQuickConnect, showDockerModal, showLocalTerminalModal, showSerialModal, showSettings, showAppMenu,
    showCommandPalette,
    showTerminalSearch,
    groupDefaultsTarget,
    vaultLocked, setVaultLocked,
    mainView, activeNavItem, sidebarCollapsed } = useAppStore();
```

- [ ] **Step 3: Replace the two left columns with one.** Find:
```tsx
          <Sidebar />
          {activeNavItem === 'snippets' ? <SnippetPanel /> : <SessionPanel />}
```
Replace with:
```tsx
          {!sidebarCollapsed && (
            <div className="sidebar-column">
              {activeNavItem === 'snippets' ? <SnippetPanel /> : <SessionPanel />}
              <SidebarFooter />
            </div>
          )}
```

- [ ] **Step 4: Verify.** Run `npx tsc --noEmit` (Expected: exit 0) and `npm run build` (Expected: success).

- [ ] **Step 5: Commit.**
```bash
git add src/App.tsx
git commit -m "feat(nav): render single sidebar-column instead of rail + sub-panel"
```

---

### Task 6: TabBar expand button when collapsed

**Files:**
- Modify: `src/components/TabBar/TabBar.tsx`

- [ ] **Step 1: Add the store fields + icon import.** Add `PanelLeftOpen` to the lucide import (line 3) and `sidebarCollapsed, toggleSidebar` to the destructure (line 8):
```tsx
import { X, Plus, Menu, ChevronDown, FolderOpen, Columns2, PanelLeftOpen } from 'lucide-react';
```
```tsx
  const { tabs, activeTabId, setActiveTab, removeTab, setShowNewSession, setShowSerialModal, setShowDockerModal, setShowLocalTerminalModal, setShowQuickConnect, sftpPanelOpen, toggleSftpPanel, splitTabId, setSplitTabId, sidebarCollapsed, toggleSidebar } = useAppStore();
```
(Note: `setShowQuickConnect` was already added here in Task 1.)

- [ ] **Step 2: Render the expand button as the first child of `.tab-bar`.** Immediately after `<div className="tab-bar">` (line 53), add:
```tsx
      {sidebarCollapsed && (
        <button className="tab-add-btn" onClick={toggleSidebar} title={t('nav_toggle_sidebar')}>
          <PanelLeftOpen size={14} />
        </button>
      )}
```

- [ ] **Step 3: Verify.** Run `npx tsc --noEmit` (Expected: exit 0).

- [ ] **Step 4: Commit.**
```bash
git add src/components/TabBar/TabBar.tsx
git commit -m "feat(nav): TabBar shows expand button when sidebar collapsed"
```

---

### Task 7: Delete IconNav + remove dead `.icon-navbar` CSS

**Files:**
- Delete: `src/components/Sidebar/IconNav.tsx`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Confirm IconNav is unreferenced.** Run:
```bash
grep -rn "IconNav\|from './components/Sidebar/IconNav'\|<Sidebar" src/
```
Expected: no matches (App.tsx no longer imports/renders it after Task 5).

- [ ] **Step 2: Delete the file.**
```bash
git rm src/components/Sidebar/IconNav.tsx
```

- [ ] **Step 3: Remove the `.icon-navbar` rule block** from `src/styles/global.css` (the rule starting at `.icon-navbar {` near line 215, through its closing brace; the `--navbar-width`-using block). Leave `.nav-icon-btn` and its `:hover`/`.active` rules — they are reused by `SidebarFooter`. Leave `.nav-spacer` (harmless).

- [ ] **Step 4: Verify.** Run `npx tsc --noEmit` (Expected: exit 0), `npm run build` (Expected: success), `npm run smoke:check` (Expected: `Result: PASS`).

- [ ] **Step 5: Commit.**
```bash
git add -A
git commit -m "chore(nav): delete IconNav + dead .icon-navbar CSS"
```

---

### Task 8: Final verification (visual — user)

**Files:** none.

- [ ] **Step 1: Build gates.** `npx tsc --noEmit` (exit 0), `npm run build` (success), `npm run smoke:check` (PASS).

- [ ] **Step 2: Visual checklist (run `npm run tauri dev`, or browser via Vite + Tauri shim).** Confirm:
  - Exactly **two** left-to-right regions when not collapsed: one sidebar + tab/content.
  - Sidebar header = title + search only (no Settings/folder/copy/link icons).
  - Clicking the sidebar **title** focuses the 列表 (asset-list) tab.
  - `+` create menu lists: 快速连接, SSH, 本地终端, Docker, 远程连接› (and 快速连接 opens the Quick Connect modal).
  - Footer row shows 片段 / 主题 / 折叠 / 菜单; 片段 swaps the body to the snippet list and back; 主题 toggles theme; 菜单 opens the app menu.
  - **折叠** hides the whole sidebar; a **show-sidebar** button appears at the left of the TabBar and restores it.
  - SFTP toggle still appears in the TabBar on an SSH tab (unchanged).
  - No `密钥` / `网络服务` entries anywhere.

- [ ] **Step 2a: Known limitation to note (not a bug):** while the sidebar is collapsed, theme/menu/snippets (footer controls) are not visible — expand the sidebar to reach them. Acceptable for v1; revisit if it annoys.

---

## Self-review

- **Spec coverage:** single-column layout (Task 5), footer with snippets/theme/collapse/menu (Task 2/5), `+` gains 快速连接 (Task 1), title → 列表 tab (Task 4), 4 dead icons removed (Task 4), keys/services stubs removed (they lived only in IconNav → deleted in Task 7), SFTP kept in TabBar (untouched), expand-when-collapsed (Task 6), IconNav + `.icon-navbar` removed (Task 7). Asset table kept (untouched). All spec points covered.
- **Deviation from spec (intentional):** spec listed a footer 文件/SFTP button; exploration found SFTP already lives contextually in the TabBar, so it is NOT duplicated in the footer (footer = 片段/主题/折叠/菜单). Documented in Task 2 comment + Task 8 checklist.
- **Type consistency:** `setShowQuickConnect` added to both SessionPanel and TabBar destructures before use; `sidebarCollapsed`/`toggleSidebar` exist on the store (verified). `activeNavItem` toggled between `'snippets'` and `'sessions'`; body condition is `activeNavItem === 'snippets'`, so any non-snippets value renders SessionPanel — consistent. `nav_assetlist`, `nav_snippets`, `nav_toggle_theme`, `nav_toggle_sidebar`, `nav_menu`, `panel_asset_list`, `panel_search` are existing keys; only `newasset_quickconnect` is new (added Task 1).
- **No automated tests:** this repo has none for UI; per-task gate is tsc/build/smoke, final behavior is user-verified (documented).
