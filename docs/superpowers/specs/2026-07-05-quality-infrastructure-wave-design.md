# Quality Infrastructure Wave — Design Spec

**Date:** 2026-07-05
**Status:** Draft (awaiting user review)
**Author:** ZCode (brainstorming session)
**Scope:** A single coordinated wave that lays the engineering foundation for all
subsequent GWShell evolution. Covers CI/quality gates, error-handling unification,
security hardening, and database migration framework. Explicitly excludes new
user-visible features, the TerminalView.tsx refactor, and CSS reorganization
(those get their own specs).

---

## 1. Goals & Non-Goals

### 1.1 Goals

1. **Make existing test investment pay off** — 159 Rust `#[test]`s and 3 Node
   `.mjs` test scripts exist but never run in CI. Wire them in.
2. **Establish lint/format baseline** — zero ESLint/Prettier/Clippy/rustfmt today.
   Add them with strict config so every future PR is auto-checked.
3. **Unify error presentation** — replace the current 3-way inconsistent error
   surfacing (inline state / red terminal text / `console.error`) and 7+ native
   `window.confirm` calls with a single toast system + an in-app confirm dialog.
4. **Close concrete security gaps** — `pty.rs` thread leak under queue pressure,
   `serial.rs` hardcoded flow control, missing SBOM, undocumented Argon2 params.
5. **Unlock future schema evolution** — replace ad-hoc `CREATE TABLE IF NOT EXISTS`
   - silent `ALTER TABLE` with a real migration framework so SessionConfig
     refactors (e.g. discriminated union) don't get blocked.

### 1.2 Non-Goals (explicitly out of scope, each gets its own spec later)

- Splitting `TerminalView.tsx` (2343 lines) — separate spec.
- Splitting `global.css` (5630 lines) — separate spec.
- React performance work (`React.memo`, list virtualization) — depends on the
  TerminalView split, separate spec.
- Any new README "Planned" feature (RDP, VNC, recording, plugins, 6 new UI
  languages, etc.) — separate specs.
- a11y focus-trap for modals — separate spec (small but UX-visible).
- Bumping the CI release matrix to 5-OS / arm64 builds — deferred, current 3-OS
  matrix stays for this wave.

### 1.3 Success Criteria

- `npm run ci:check` (a new aggregate script) passes locally before every push,
  running: `tsc` + `vite build` + `smoke:check` + `eslint` + `prettier --check`
  - the 3 `.mjs` test scripts.
- `cargo test` runs in CI and passes (all 159 existing tests green).
- `cargo clippy -- -D warnings` and `cargo fmt --check` pass in CI.
- Zero `window.confirm` calls remain in `src/` (grep-enforced by smoke:check).
- A typed `<ToastProvider>` is mounted at `App.tsx` root; `useToast()` is the
  only sanctioned way to surface non-fatal errors.
- `pty.rs` exposes a `close_pty_wait` joining the writer thread; `close_pty`
  is redefined in terms of it.
- `serial.rs` accepts a `flow_control` field (None/Software/Hardware).
- `vault.rs` carries a documented `Argon2id` instance with explicit params and
  an inline OWASP-references comment.
- `database.rs` initializes via `refinery` migrations; the existing schema is
  captured in `migrations/V001__initial.sql`. A `schema_migrations` table
  replaces the ad-hoc ALTER pattern.
- `cargo audit` + `npm audit` run on every PR and on a weekly schedule.
- SBOM (CycloneDX) is generated on release builds and attached to the GitHub
  release.
- `stability-smoke.mjs` additionally verifies: (a) `gwshell.en.json` and
  `gwshell.zh.json` have identical key trees; (b) every backend `emit("x-{id}")`
  has a matching frontend `listen("x-{id}")`; (c) `capabilities/default.json`
  has not grown a permission not on an allowlist.

---

## 2. Sub-project A — CI / Quality Gates

### 2.1 New tooling config files

| File               | Purpose                                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.eslintrc.cjs`    | `@typescript-eslint` `strict-type-checked` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` (Vite). Banned: `any`, `console.*` outside `lib/`/`stores/`, `@ts-ignore`. |
| `.prettierrc.json` | 2-space indent, single quotes for JS/TS, double for JSX, no trailing comma all, printWidth 100. Matches `tsconfig.json` + AGENTS.md "Two-space indent" rule.                        |
| `.prettierignore`  | `dist/`, `node_modules/`, `src-tauri/target/`, `src-tauri/gen/`, `package-lock.json`, `*.min.js`.                                                                                   |
| `.eslintignore`    | Same as prettier, plus `src/i18n/locales/**` (generated-looking JSON).                                                                                                              |
| `rustfmt.toml`     | `edition = "2021"`, `max_width = 100`, `fn_single_line = true` (subjective; matches existing code style on review).                                                                 |
| `clippy.toml`      | `msrv = "1.80"` (per AGENTS.md), `type-complexity-threshold = 250` (existing AppState is borderline).                                                                               |
| `.editorconfig`    | UTF-8, LF, final newline, 2-space for `*.{ts,tsx,js,mjs,json,css,md,toml}`, 4-space for `*.rs`.                                                                                     |
| `.gitattributes`   | `* text=auto eol=lf` (already partially present, complete it).                                                                                                                      |

### 2.2 `package.json` new scripts

```json
"lint": "eslint src --max-warnings 0",
"lint:fix": "eslint src --fix",
"format": "prettier --write .",
"format:check": "prettier --check .",
"test:node": "node scripts/test-completion.mjs && node scripts/test-split-layout.mjs && node scripts/verify-webgl-lifecycle.mjs",
"ci:check": "npm run build && npm run smoke:check && npm run lint && npm run format:check && npm run test:node"
```

Existing `version` lifecycle script unchanged. The `build` script (`tsc && vite build`) stays first because `cargo check` depends on `../dist` existing (tauri `build.rs`).

### 2.3 `src-tauri/Cargo.toml` new dev-deps

```toml
[dev-dependencies]
refinery = { version = "0.8", features = ["rusqlite"] }
```

(refinery is also a runtime dep — see §5.)

### 2.4 `.github/workflows/ci.yml` changes

Current steps: install → build → smoke:check → cargo check (ubuntu only).
New steps (in order):

1. `npm ci` (existing, with `.npmrc` retry/mirror guard preserved).
2. `npm run build` (existing).
3. `npm run smoke:check` (existing).
4. `npm run lint` (NEW).
5. `npm run format:check` (NEW).
6. `npm run test:node` (NEW — runs the 3 `.mjs` scripts).
7. `cargo fmt --check` (NEW).
8. `cargo clippy -- -D warnings` (NEW, runs on each OS in matrix).
9. `cargo test` (NEW — currently 159 tests across 22 modules, all should pass).
10. `cargo check` (existing, now runs on the matrix below).

**Matrix change:** steps 8–10 run on a 3-OS matrix:

```yaml
strategy:
  fail-fast: false
  matrix:
    os: [ubuntu-22.04, macos-14, windows-latest]
runs-on: ${{ matrix.os }}
```

Steps 1–6 stay ubuntu-only (frontend tooling is OS-independent). Use two jobs:
`frontend` (ubuntu, steps 1–6) and `backend` (3-OS matrix, steps 7–10), with
`backend` depending on `frontend` only to share the install cache (or parallel
with separate caches — TBD during impl, recommend parallel for speed).

### 2.5 New `.github/workflows/security.yml`

Runs on PR + weekly schedule (Mon 03:00 UTC):

```yaml
on:
  pull_request:
  schedule:
    - cron: '0 3 * * 1'
jobs:
  audit:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions-rust-lang/setup-rust-toolchain@v1
      - run: cargo install cargo-audit
      - run: cargo audit --deny warnings
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm audit --omit=dev --audit-level=high
```

### 2.6 `.github/workflows/release.yml` changes

Add a `sbom` step after the build, before the draft release:

```yaml
- name: Generate SBOM
  run: |
    cargo install cargo-cyclonedx
    cargo cyclonedx --format json --output-pattern package
- name: Upload SBOM
  uses: softprops/action-gh-release@v2
  with:
    files: gwshell.cdx.json
```

### 2.7 `stability-smoke.mjs` extensions

Add three new checks (each emits a descriptive error and exits non-zero on
failure, mirroring the existing IPC parity check style):

**A. i18n key parity** — load `src/i18n/locales/gwshell.en.json` and
`gwshell.zh.json`, recursively walk both, assert the key trees are identical
(same keys, same nesting, same arrays-of-objects length). Report the first
diff. This codifies the AGENTS.md "key-for-key identical" rule.

**B. Event-name parity** — scan `src-tauri/src/**/*.rs` for
`emit\("([a-z-]+)-\{` patterns, collect the prefix set (e.g.
`pty-data`, `ssh-data`, `serial-data`, `sftp-progress`, `server-metrics`,
plus the `*-exit` variants). Scan `src/**/*.{ts,tsx}` for
`listen\("([a-z-]+)-\{` patterns, collect the same. Assert the sets are
equal (with an explicit allowlist of expected names so renames surface).
Output a clear diff on failure.

**C. Capabilities allowlist** — load `src-tauri/capabilities/default.json`,
assert every entry in `permissions` is on a hardcoded allowlist inside the
script. Adding a new permission requires adding it to the allowlist in the
same PR, which forces a security review during code review. Allowlist the
current 23 entries.

### 2.8 Backwards compatibility

- ESLint will likely flag existing code on first run. Plan: run
  `eslint --fix` once to auto-resolve stylistic issues, manually fix the
  remaining ~20–50 issues (mostly `any`/`console.*`/unused imports), commit
  as a single `chore: enable eslint` commit _before_ the workflow file lands.
  This way CI goes green on the first run with linting enabled.
- Same for `prettier --write` — single `chore: apply prettier` commit.
- Same for `cargo fmt` — single `chore: cargo fmt` commit.
- `cargo clippy -D warnings` may surface ~10–30 lints; fix per-lint, document
  any intentional `#[allow(clippy::...)]` with a reason comment.

---

## 3. Sub-project B — Error Handling Unification

### 3.1 Architecture

Three new pieces, all under `src/`:

1. **`stores/toastStore.ts`** — Zustand store holding a `Toast[]` array.
   Each toast: `{ id, kind: 'info'|'success'|'warning'|'error', title, message?, durationMs?, action? }`.
   Actions: `pushToast`, `dismissToast`, `clear`. Auto-dismiss via `setTimeout`
   in the action (default 5s for non-error, 0 = sticky for error unless
   dismissed). `pushToast` returns `id` so callers can update later.

2. **`components/Toast/ToastProvider.tsx`** — mounted once at `App.tsx` root,
   reads `toastStore`, renders a fixed-position stack bottom-right (matches
   `UpdateChecker`'s existing `.update-toast` position). Each toast is a
   `<div role="status" aria-live="polite">` (or `role="alert"` for error)
   styled via `styles/theme.css` tokens (`--bg-elevated`, `--border-color`,
   `--text-primary`, `--accent-danger`, `--shadow-elevated`). Animations via
   CSS transitions (opacity + translateX), no framer-motion dependency.

3. **`hooks/useToast.ts`** — thin wrapper exposing `toast.info/success/warning/error`
   bound to the store. This is the only sanctioned import path for non-fatal
   error surfacing.

4. **`hooks/useConfirm.ts`** — backed by a `confirmStore` (Zustand). `confirm({
title, message, confirmLabel, cancelLabel, danger })` returns
   `Promise<boolean>`. Mounts a single `<ConfirmDialog>` at `App.tsx` root
   reusing `TabBar`'s existing `role="alertdialog" aria-modal="true"` styling
   (extract that CSS into `styles/confirm.css` or keep in `global.css` and
   reference by class). Keyboard: Enter confirms, Esc cancels, focus trapped
   while open.

### 3.2 Migration plan (call sites)

**Replace `window.confirm`** (7 sites, from audit):

- `SessionPanel` (×1, delete session confirm)
- `SnippetPanel` (×1, delete snippet)
- `SftpPanel` (×1, overwrite/rmtree)
- `SftpEditor` (×1, discard unsaved)
- `AgentActionQueue` (×1, confirm risky action)
- `AssetTable` (×2, delete host / delete group)

Each call site moves to `const confirm = useConfirm(); ... if (await confirm({...})) {...}`.

**Wire optimistic-rollback failures to toast** (silent today):

- `snippetStore.add/update/remove` — `catch` rolls back UI + calls
  `toast.error({ title: t('common.error'), message: err })`.
- `appStore.removeSession` — same pattern, `t('sessions.deleteFailed')`.
- `appStore.addSession` / `updateSession` (any path that catches and rolls back).
- `agentPolicyStore` save failures.

**Replace bare `console.error`** in 12 files: route through `toast.error` when
the error is actionable by the user; keep `console.error` for diagnostic-only
errors (e.g. listener cleanup failures). Add an ESLint rule (`no-console` with
allowlist `lib/logger.ts` if we add one, or `stores/*`) to enforce.

### 3.3 i18n keys to add

Both `gwshell.en.json` and `gwshell.zh.json` get a new `common` section:

```json
"common": {
  "error": "Error" / "错误",
  "success": "Success" / "成功",
  "warning": "Warning" / "警告",
  "info": "Information" / "提示",
  "dismiss": "Dismiss" / "关闭",
  "confirm": "Confirm" / "确认",
  "cancel": "Cancel" / "取消"
},
"toast": {
  "sessionDeleted": "Session deleted" / "会话已删除",
  "sessionDeleteFailed": "Failed to delete session" / "删除会话失败",
  "snippetSaved": "Snippet saved" / "代码片段已保存",
  "snippetSaveFailed": "Failed to save snippet" / "保存代码片段失败",
  "snippetDeleted": "Snippet deleted" / "代码片段已删除",
  "snippetDeleteFailed": "Failed to delete snippet" / "删除代码片段失败"
}
```

smoke:check (§2.7A) enforces en/zh parity automatically from now on.

### 3.4 Component file layout

```
src/
  components/
    Toast/
      ToastProvider.tsx     (~80 lines)
      ToastItem.tsx         (~50 lines)
      toast.css             (co-located, theme-token-driven)
    ConfirmDialog/
      ConfirmDialog.tsx     (~70 lines)
      confirm.css          (co-located)
  hooks/
    useToast.ts             (~25 lines)
    useConfirm.ts           (~30 lines)
  stores/
    toastStore.ts           (~50 lines)
    confirmStore.ts         (~40 lines)
```

### 3.5 Backwards compatibility

`UpdateChecker` and `SecurityNotice` already render their own toast-shaped
`.update-toast` div. Migrate them to `<ToastProvider>` calls in the same wave
(they become `toast.info(...)` / `toast.warning(...)`). Delete the now-orphan
`.update-toast` CSS rules from `global.css`.

---

## 4. Sub-project C — Security Hardening

### 4.1 `vault.rs` — documented Argon2id params

Replace `Argon2::default()` with an explicit `Argon2id` instance using the
default OWASP-recommended params, but with a named constant and an inline
comment block citing the source. No behavioral change (default IS the
OWASP-recommended preset in argon2 0.5), but it makes the choice auditable.

```rust
// Argon2id with OWASP-recommended minimum params (argon2 0.5 defaults):
//   m_cost = 19456 KiB (~19 MiB)
//   t_cost = 2 iterations
//   p_cost = 1 lane
// Source: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
// Rationale: this verifies a local UI unlock gate, not a server-side hash
// database. The threat model is an attacker who stole the DB file but does
// NOT have the OS keyring master key (which is what actually protects
// secrets — see crypto.rs). The vault gate only needs to be expensive
// enough to make brute-forcing the passphrase over the DB-local Argon2
// verifier uneconomical. Default params achieve that while keeping unlock
// under ~50ms on commodity laptops.
fn argon2id() -> Argon2<'static> {
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(19_456, 2, 1, None).expect("hardcoded valid params"),
    )
}
```

Both `set_passphrase` and `verify` call `argon2id()` instead of
`Argon2::default()`. Add a unit test asserting both paths use the same
algorithm/params.

### 4.2 `pty.rs` — join writer thread on close

Current `close_pty` (`pty.rs:543`) sends `PtyCmd::Close` via `try_send` and
discards the error (`let _ =`). If the channel is full (limit 64), the close
signal is silently dropped and the child + writer thread leak.

**Fix:** mirror `serial.rs`'s `close_serial_wait` pattern.

```rust
/// Remove a session and block until its writer thread has fully torn down
/// (child killed + waited, reader joined). Use this when the caller can
/// afford to wait; for app-wide shutdown use `close_all` which signals
/// without joining.
pub fn close_pty_wait(&self, session_id: &str) -> Result<(), String> {
    let handle = self.sessions.lock().remove(session_id);
    if let Some(mut handle) = handle {
        // Best-effort signal; ignore Full error since we'll join next.
        let _ = handle.cmd_tx.try_send(PtyCmd::Close);
        // Drop the input-only sender so any pending try_send from the frontend
        // fails fast instead of queueing behind Close.
        drop(handle.cmd_tx.clone());
        if let Some(join) = handle.writer_join.take() {
            join.join()
                .map_err(|_| "writer thread panicked".to_string())?;
        }
    }
    Ok(())
}

/// Non-blocking close: signal and remove. Convenience wrapper around
/// `close_pty_wait` for callers that don't care to wait.
pub fn close_pty(&self, session_id: &str) {
    let _ = self.close_pty_wait(session_id);
}
```

`PtyHandle` gains a `writer_join: Option<JoinHandle<()>>` field, set when the
writer thread is spawned (`pty.rs:330`). `close_all` continues to signal-only
(app-shutdown must not block on a hung child).

The `try_send(Close)` `Full` case becomes harmless because `close_pty_wait`
joins the thread regardless: even if the signal was dropped, the writer thread
will see its channel disconnect (senders dropped) and exit. The `let _ =` is
now correct, not a leak.

Add a test that opens a pty, fills the channel past the limit, then calls
`close_pty_wait` and asserts the JoinHandle is consumed (thread exited).

### 4.3 `serial.rs` — expose flow control

Current `serial.rs:101` hardcodes `FlowControl::None`. Expose it:

- Extend `SerialOpenParams` (the IPC payload from the frontend) with a
  `flow_control: Option<String>` field. Accept `"none"`/`"software"`/
  `"hardware"` (case-insensitive), default `"none"`.
- Map: `none → FlowControl::None`, `software → FlowControl::Software` (XON/XOFF),
  `hardware → FlowControl::Hardware` (RTS/CTS).
- Frontend `SerialPortModal` adds a dropdown with three options. i18n keys
  `serial.flowControl.{none,software,hardware}`.
- Persist the choice in `SessionConfig.serial_flow_control: Option<String>`
  (additive field, no migration needed — serde defaults to `None`).

### 4.4 SBOM generation

Covered in §2.6. `cargo cyclonedx` produces `gwshell.cdx.json`, attached to
the GitHub release alongside the installers. Provides a complete dependency
tree for supply-chain auditing (CycloneDX 1.4 format).

### 4.5 Cargo audit + npm audit

Covered in §2.5. Runs on every PR + weekly. `--deny warnings` fails CI on any
advisory with a fix available; advisories without fixes are reported but don't
fail (so we're not blocked on upstream waiting for a patch).

---

## 5. Sub-project D — Database Migration Framework

### 5.1 Why refinery

`refinery` is the de facto Rust migration tool: embeds `.sql` files at compile
time via `embed_migrations!`, tracks applied versions in a `schema_migrations`
table, runs each migration in a transaction. No external CLI dependency, no
runtime file lookups (migrations are baked into the binary). Supports
rusqlite out of the box.

### 5.2 Migration directory layout

```
src-tauri/migrations/
  V001__initial.sql          # captures the current schema as of v0.5.5
  V002__session_flow_control.sql  # placeholder example for §4.3 (additive)
  ...
```

### 5.3 `V001__initial.sql`

Captures the existing schema verbatim from `database.rs:41–92`, replacing the
ad-hoc `CREATE TABLE IF NOT EXISTS` calls. The `command_history` ALTERs
(cwd/scope/session_type columns) are folded in: V001 creates the table with
those columns already present. Existing databases (which have the columns via
ALTER) are detected by refinery's `schema_migrations` check; if the table
already exists, V001 must be a no-op.

**Bootstrap path:** on first run after the upgrade, `refinery` will see no
`schema_migrations` table. We run a one-shot `migrate_to_v001_baseline()` that:

1. Creates `schema_migrations` if missing.
2. Checks each existing table/column for existence (using `PRAGMA table_info`).
3. If the V001 schema already matches (the common case — user is on v0.5.5),
   inserts `V001` into `schema_migrations` to mark it applied, then runs V002+
   normally.
4. If the schema is older (pre-ALTER `command_history`), runs V001 in full
   (which `CREATE TABLE IF NOT EXISTS` is a no-op for existing tables, and
   the column adds are folded into the CREATE — but the existing table lacks
   them, so we ALTER within V001 for safety).

This preserves the existing silent-migration behavior for current users while
putting a real framework in place for future changes.

### 5.4 `database.rs` integration

Replace the `init_tables` function with:

```rust
use refinery::embed_migrations;
embed_migrations!("migrations");

impl Database {
    pub fn new(path: &Path) -> Result<Self, String> {
        let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        conn.pragma_update(None, "synchronous", "NORMAL").ok();
        // Bootstrap existing v0.5.5 databases into the refinery world.
        migrate_to_v001_baseline(&conn)?;
        // Apply any pending migrations (V002+).
        migrations::runner()
            .run(&mut conn)
            .map_err(|e| format!("migration failed: {}", e))?;
        Ok(Self { conn: Mutex::new(conn) })
    }
}
```

> Note: the exact `refinery` 0.8 API is `migrations::runner().run(&mut Connection)`.
> The signature above is illustrative; the implementer should verify against
> `refinery` docs at impl time and adjust the `Connection` borrow path
> accordingly (the bootstrap helper takes `&Connection`, refinery itself
> needs `&mut Connection` — a small refactor of the borrow order may be needed).

The `migrate_to_v001_baseline` helper is the only special-cased logic; everything
after V001 goes through standard refinery. After this lands, future schema
changes are pure SQL files in `migrations/` — no Rust code changes needed.

### 5.5 Testing migrations

Add a Rust integration test (`src-tauri/tests/migrations.rs`) that:

1. Creates an in-memory SQLite DB.
2. Runs migrations from scratch; asserts the V001 schema is present.
3. Inserts a sample row in each table; asserts round-trip.
4. For each migration V002+, asserts it applies cleanly.

Add a second test that loads a fixture SQL file representing a v0.5.5
database (created by running the old `init_tables`), runs the baseline
detection + migrations, and asserts no data loss.

---

## 6. Build Sequencing

Strict order — each step is independently shippable and reviewable as a PR:

1. **PR1: `chore: enable lint/format tooling`** — adds all config files from
   §2.1, runs `eslint --fix` + `prettier --write .` + `cargo fmt`, commits the
   bulk reformat. No CI changes yet. Reviewable as a diff.

2. **PR2: `chore: fix eslint/clippy violations`** — fixes the remaining
   substantive lints (`any`, `console.*`, unused vars, clippy warnings).
   Adds `#[allow(clippy::...)]` with reason comments where intentional.

3. **PR3: `ci: run tests, lint, clippy on 3-OS matrix`** — updates `ci.yml`
   per §2.4, adds `security.yml` per §2.5, updates `release.yml` per §2.6,
   adds the `stability-smoke.mjs` extensions from §2.7. From this point CI is
   the safety net for everything that follows.

4. **PR4: `feat: toast + confirm dialog system`** — adds the §3.1 files,
   mounts providers at `App.tsx` root, migrates the 7 `window.confirm` call
   sites, wires optimistic-rollback failures to toast, adds the i18n keys,
   migrates `UpdateChecker`/`SecurityNotice`. smoke:check gains the
   `no-window-confirm` grep assertion.

5. **PR5: `security: pty thread join + serial flow control + documented argon2`**
   — §4.1, §4.2, §4.3. Each fix includes a regression test. SBOM (§4.4) is
   already in PR3's release.yml change.

6. **PR6: `refactor(db): adopt refinery migration framework`** — §5. Adds
   `refinery` dep, `migrations/V001__initial.sql`, the bootstrap helper,
   integration tests. From this point schema changes are SQL-only.

PR1 and PR2 must land before PR3 (CI would otherwise fail on the first run).
PR4, PR5, PR6 are independent of each other and can land in any order after
PR3, in parallel if multiple reviewers are available.

---

## 7. Testing Strategy

### 7.1 What's covered after this wave

| Layer            | Coverage                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust unit        | All 159 existing `#[test]`s run in CI per OS. New tests for `pty::close_pty_wait`, `vault::argon2id` consistency, `serial::flow_control` mapping. |
| Rust integration | New `tests/migrations.rs` covering refinery up + baseline paths.                                                                                  |
| Node scripts     | 3 existing `.mjs` scripts run in CI.                                                                                                              |
| Smoke            | Extended: IPC parity (existing) + i18n key parity + event-name parity + capabilities allowlist + no-`window.confirm` grep.                        |
| Frontend         | Still no Vitest/RTL — explicitly out of scope for this wave (separate spec).                                                                      |
| E2E              | None — out of scope.                                                                                                                              |

### 7.2 What's explicitly not tested here

- Toast UI rendering (visual — manual verification in PR4 description).
- ConfirmDialog keyboard flow (manual verification; full a11y audit separate spec).
- SFTP path resolution regression test (separate spec).
- IPC round-trip behavior beyond name parity (separate spec).

---

## 8. Risk & Rollback

| Risk                                                                                         | Mitigation                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ESLint bulk reformat (PR1) obscures real changes in `git blame`                              | Add `.git-blame-ignore-revs` file pointing at the reformat commit SHA. Document in AGENTS.md.                                                                                                                            |
| `cargo clippy -D warnings` finds an unfixable lint in third-party macro-generated code       | Use `#[allow(clippy::...)]` scoped to the smallest possible block with a reason comment.                                                                                                                                 |
| refinery bootstrap mis-detects an existing v0.5.5 database and re-runs V001, corrupting data | V001 uses `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` (idempotent). Add the §5.5 baseline-fixture test. Ship PR6 behind a feature flag for one release cycle.                                                |
| `pty::close_pty_wait` blocks the UI thread if the child won't die                            | Caller (`close_pty` IPC command) already runs in `tokio::spawn_blocking`. Add a 2-second timeout wrapping the join, falling back to signal-only on timeout.                                                              |
| Toast migration breaks `UpdateChecker` auto-update flow                                      | Manual test of the update check flow before PR4 merge. Keep the old `.update-toast` CSS until PR4 is verified, remove in a follow-up.                                                                                    |
| Cargo audit fails CI on an advisory with no fix                                              | Use `cargo audit --deny warnings` for PRs (strict) but `cargo audit` (warning-only) for the weekly schedule, so weekly reports surface but don't break. Per-PR strictness catches new deps with known fixes immediately. |

---

## 9. Open Questions for Reviewer

None. All decisions made during brainstorming:

- Toast: self-written (no third-party dep). ✅
- Argon2: keep default params, document them. ✅
- CI matrix: 3-OS minimum (ubuntu/macos-14/windows-latest). ✅
- Wave scope: CI + error handling + security + DB migrations. ✅

---

## 10. Out of Scope (explicit reminders)

The following came up during audit but are **not** in this wave:

- `TerminalView.tsx` (2343 lines) decomposition — next spec.
- `global.css` (5630 lines) split — separate spec.
- `React.memo` + list virtualization for `AssetTable`/`SessionPanel` — depends on TerminalView split.
- a11y focus-trap for the 6 existing `Modals/*` — separate small spec (the new `ConfirmDialog` will have focus-trap, but extending to all modals is separate).
- Metrics poller exponential backoff — separate spec.
- smoke:check orphan-command detection (backend commands never called from frontend) — separate enhancement.
- All README "Planned 🚧" features (RDP/VNC/Telnet/rsync/recording/plugins/new i18n/WebDAV-S3/DB client) — each its own spec.
- 5-OS CI matrix + arm64 release builds — deferred to a future "release matrix expansion" spec.

---

## 11. References

- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- refinery docs: https://docs.rs/refinery
- CycloneDX cargo plugin: https://github.com/CycloneDX/cyclonedx-rust-cargo
- AGENTS.md (repo conventions): `/Users/zhengshan/projects/gwshell/AGENTS.md`
- Audit findings (this session): sections 2–6 above, drawn from the three parallel
  Explore-agent audits of frontend, backend infrastructure, and CI/tooling.
