# Phase 3c-1: Group Cascading Defaults — Spec + Plan

> REQUIRED SUB-SKILL: subagent-driven-development. Frontend-only, no Rust.

**Goal:** A session group can define default SSH connection fields that member sessions inherit at connect-time when their own value is unset. Edited via a small modal from the group header.

**Design (decisions):** The active group model is the `group?: string` tag on each `SessionConfig` (SessionPanel buckets by it). So group defaults are stored frontend-only as `Record<groupName, GroupDefaults>` in localStorage (`gwshell.groupDefaults`), and a resolver fills unset inheritable fields on the session right before connecting (one spot in TerminalView). Inheritable fields (curated, non-secret): `username, port, auth_method, private_key_path, jump_host, jump_port, jump_username, jump_private_key_path, proxy_type, proxy_host, proxy_port, proxy_username, env_vars`. Passwords/secrets are NOT inheritable (security). No backend change.

## Verification: `npx tsc --noEmit`, `npm run smoke:check`, `npm run build`. No cargo. Commit per task.

---

### Task 1: `src/lib/groupDefaults.ts`

- [ ] Create with:
```ts
import type { SessionConfig } from '../types';

// Curated, non-secret fields a group can supply as defaults.
export const INHERITABLE_FIELDS = [
  'username', 'port', 'auth_method', 'private_key_path',
  'jump_host', 'jump_port', 'jump_username', 'jump_private_key_path',
  'proxy_type', 'proxy_host', 'proxy_port', 'proxy_username', 'env_vars',
] as const;

export type GroupDefaults = Partial<Pick<SessionConfig, typeof INHERITABLE_FIELDS[number]>>;
export type GroupDefaultsMap = Record<string, GroupDefaults>;

const KEY = 'gwshell.groupDefaults';

export function loadGroupDefaults(): GroupDefaultsMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as GroupDefaultsMap) : {};
  } catch { return {}; }
}

export function saveGroupDefaults(map: GroupDefaultsMap): void {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

function isUnset(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

// Returns a session with inheritable fields filled from its group's defaults
// where the session's own value is unset. Pure; returns a new object.
export function applyGroupDefaults(session: SessionConfig, all: GroupDefaultsMap): SessionConfig {
  if (!session.group) return session;
  const defs = all[session.group];
  if (!defs) return session;
  const out: SessionConfig = { ...session };
  for (const f of INHERITABLE_FIELDS) {
    if (isUnset(out[f]) && !isUnset(defs[f])) {
      (out as Record<string, unknown>)[f] = defs[f];
    }
  }
  return out;
}
```
- [ ] `npx tsc --noEmit` clean. Commit `feat(group-defaults): inheritable-fields resolver + localStorage`.

---

### Task 2: Apply resolver at connect (TerminalView)

- [ ] In `src/components/Terminal/TerminalView.tsx`, find in `setupConnection` where the session is fetched: `const session = sessionsRef.current.find((s) => s.id === tab.sessionId);`. Replace the usage so the resolved config is used. Add import `import { applyGroupDefaults, loadGroupDefaults } from '../../lib/groupDefaults';`. Change to:
```ts
        const rawSession = sessionsRef.current.find((s) => s.id === tab.sessionId);
        const session = rawSession ? applyGroupDefaults(rawSession, loadGroupDefaults()) : rawSession;
```
  (Keep the rest of setupConnection identical — it already reads `session`.) READ the file to confirm the exact `const session = ...find...` line and that `session` is used (not `rawSession`) downstream. If `session` is declared with a different pattern, adapt: resolve immediately after the find, keeping the variable name `session` for downstream code.
- [ ] Do NOT touch terminal key handling, write path, or anything else.
- [ ] `npx tsc --noEmit` clean. Commit `feat(group-defaults): apply group defaults to session on connect`.

---

### Task 3: appStore flag + SessionPanel trigger

- [ ] In `src/stores/appStore.ts`: interface + impl add:
```ts
  groupDefaultsTarget: string | null;
  setGroupDefaultsTarget: (group: string | null) => void;
```
impl: `groupDefaultsTarget: null, setGroupDefaultsTarget: (group) => set({ groupDefaultsTarget: group }),`
- [ ] In `src/components/Sidebar/SessionPanel.tsx`: add `Settings` (gear) icon to the lucide import if not present; add `setGroupDefaultsTarget` to the `useAppStore()` destructure. In the group header (the `<div className="session-group-header" ...>` around line 189), add a small gear button AFTER the group name span that calls `setGroupDefaultsTarget(groupName)` (stopPropagation so it doesn't toggle the group):
```tsx
                <button
                  className="session-group-defaults-btn"
                  onClick={(e) => { e.stopPropagation(); setGroupDefaultsTarget(groupName); }}
                  title={t('group_defaults_title')}
                >
                  <Settings size={12} />
                </button>
```
- [ ] `npx tsc --noEmit` clean. Commit `feat(group-defaults): store flag + group-header trigger`.

---

### Task 4: GroupDefaultsModal + render + i18n + CSS

- [ ] Create `src/components/Modals/GroupDefaultsModal.tsx` (model the modal shell on `QuickConnectModal.tsx`: overlay + card + onMouseDown close + stopPropagation):
  - Reads `groupDefaultsTarget` (the group name) and `setGroupDefaultsTarget` from `useAppStore`. If null, render nothing (App gates it anyway).
  - On mount, `const [defs, setDefs] = useState<GroupDefaults>(() => loadGroupDefaults()[group] ?? {})`.
  - Render a compact form with inputs for: username (text), port (number), auth_method (select: password/publickey/agent/keyboardinteractive/none), private_key_path (text), jump_host (text), jump_port (number), jump_username (text), proxy_type (select: none/socks5/http), proxy_host (text), proxy_port (number), env_vars (textarea). Each writes into `defs` (numbers parsed; empty string → delete the key so it counts as unset).
  - Save button: `const all = loadGroupDefaults(); all[group] = cleaned(defs); saveGroupDefaults(all); setGroupDefaultsTarget(null);` where `cleaned` drops empty/undefined entries. Cancel/Esc/backdrop → `setGroupDefaultsTarget(null)`.
  - i18n labels (reuse existing session-field i18n keys where they exist, e.g. for username/host/port; add `group_defaults_title`, `group_defaults_hint`, `group_defaults_save`, `group_defaults_cancel`).
- [ ] `src/App.tsx`: lazy import + render `{groupDefaultsTarget !== null && <GroupDefaultsModal />}` in the Suspense modal block; add `groupDefaultsTarget` to the destructure.
- [ ] i18n: add `group_defaults_title`:"Group defaults" / "分组默认", `group_defaults_hint`:"Unset session fields inherit these" / "会话未设字段将继承这些", `group_defaults_save`:"Save"/"保存", `group_defaults_cancel`:"Cancel"/"取消" to BOTH locales.
- [ ] `global.css`: reuse `quick-connect-*` styling conventions or add `.group-defaults-*` (overlay+card+inputs+actions). `.session-group-defaults-btn { background:none; border:none; color:var(--text-muted,#888); cursor:pointer; padding:2px; } .session-group-defaults-btn:hover{color:inherit;}`.
- [ ] `npx tsc --noEmit` clean; both JSON valid. Commit `feat(group-defaults): editor modal + wiring`.

---

### Task 5: Verify
- [ ] `npm run build` + `npm run smoke:check` (retry/fallback tsc). Manual: set group defaults (e.g. username+key) → connect a member session that has those unset → it inherits; a session that sets its own value keeps it; non-SSH sessions unaffected.

## Self-review
- Inheritable set excludes secrets (no password fields). Resolver pure, applied one spot. Frontend-only. localStorage like tabSession. Non-SSH sessions: inheritable fields are SSH-only so harmless. Types: `GroupDefaults`/`GroupDefaultsMap`/`applyGroupDefaults`/`loadGroupDefaults`/`saveGroupDefaults` (T1) used in T2/T4; `groupDefaultsTarget` (T3) used T3/T4.
