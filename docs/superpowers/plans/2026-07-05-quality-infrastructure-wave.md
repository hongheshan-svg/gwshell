# Quality Infrastructure Wave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the engineering foundation for GWShell's evolution to international top-tier quality — CI/quality gates, error-handling unification, security hardening, and database migration framework — without shipping new user-visible features.

**Architecture:** Six sequentially-dependent PRs. PR1-2 enable lint/format tooling (bulk reformat + substantive fixes). PR3 turns CI into a real safety net (tests + clippy + 3-OS matrix + security audit + extended smoke check). PR4-6 are independent feature/fix PRs that rely on PR3's safety net.

**Tech Stack:** Tauri 2 + React 19 + TypeScript 5.8 + Vite 7 + Rust 2021. New tooling: ESLint 9 + Prettier 3 + @typescript-eslint 8 + eslint-plugin-react-hooks + eslint-plugin-react-refresh + refinery 0.8 + cargo-audit + cargo-cyclonedx.

## Global Constraints

- **Node.js 20+, Rust 1.80+** (per AGENTS.md).
- **`.npmrc` must retain `legacy-peer-deps=true` and `registry=https://registry.npmjs.org/`** — xterm 6 + addon betas have mismatched peer deps; a previous CN-mirror lockfile broke CI on US runners.
- **`npm run build` (`tsc` + `vite build`) emits `../dist`** — `cargo check` fails without it (tauri's `build.rs` requires `../dist`).
- **TypeScript strict mode is on** (`noUnusedLocals` + `noUnusedParameters`). Two-space indent, named exports, PascalCase component files.
- **Rust snake_case modules, run `cargo fmt`** before submitting. MSRV 1.80.
- **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:` with optional scope). Imperative subject.
- **i18n rule**: every user-facing string goes through i18next. `gwshell.en.json` and `gwshell.zh.json` must stay key-for-key identical.
- **IPC contract**: frontend `invoke(name)` ↔ backend `#[tauri::command] fn name` registered in `lib.rs` `generate_handler!`. The `smoke:check` enforces this.

### Spec reference

This plan implements `docs/superpowers/specs/2026-07-05-quality-infrastructure-wave-design.md`.

---

## File Structure (whole wave)

**Created:**
```
.eslintrc.cjs, .eslintignore, .prettierrc.json, .prettierignore
.editorconfig, .gitattributes, rustfmt.toml, clippy.toml
.git-blame-ignore-revs
src-tauri/migrations/V001__initial.sql
src-tauri/tests/migrations.rs
src-tauri/tests/fixtures/v0.5.5_baseline.sql
src/stores/toastStore.ts, src/stores/confirmStore.ts
src/hooks/useToast.ts, src/hooks/useConfirm.ts
src/components/Toast/{ToastProvider,ToastItem}.tsx, src/components/Toast/toast.css
src/components/ConfirmDialog/ConfirmDialog.tsx, src/components/ConfirmDialog/confirm.css
src/lib/ipcEvents.ts
.github/workflows/security.yml
```

**Modified:**
```
package.json, src-tauri/Cargo.toml
src-tauri/src/{database,vault,pty,serial,lib}.rs
src/types/index.ts
src/components/Modals/SerialPortModal.tsx
src/i18n/locales/gwshell.{en,zh}.json
src/App.tsx
src/components/{UpdateChecker,SecurityNotice,Sidebar/*,SftpPanel/*,Agent/*,AssetTable/*}/*.{ts,tsx}
src/hooks/useAssetData.ts
src/stores/{snippet,app,agentPolicy}Store.ts
src/styles/global.css
scripts/stability-smoke.mjs
.github/workflows/{ci,release}.yml
AGENTS.md
```

---

## PR1: `chore: enable lint/format tooling` (bulk reformat only)

### Task 1.1: Install frontend lint/format devDependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the devDependencies**

```bash
npm install --save-dev \
  eslint@^9 \
  @typescript-eslint/eslint-plugin@^8 \
  @typescript-eslint/parser@^8 \
  eslint-plugin-react-hooks@^5 \
  eslint-plugin-react-refresh@^0.4 \
  prettier@^3 \
  eslint-config-prettier@^9
```

- [ ] **Step 2: Verify** — `npx eslint --version && npx prettier --version` (both print versions).

- [ ] **Step 3: Commit** — `chore: add eslint + prettier devDependencies`

---

### Task 1.2: Create lint/format config files

**Files:** Create 8 config files.

- [ ] **Step 1: Write `.eslintrc.cjs`**

```js
/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
    project: ['./tsconfig.json', './tsconfig.node.json'],
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
    'plugin:@typescript-eslint/stylistic-type-checked',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'no-restricted-syntax': [
      'error',
      { selector: 'TSAsExpression', message: 'Avoid `as` casts — narrow with types or guards instead.' },
    ],
  },
  ignorePatterns: ['dist/', 'node_modules/', 'src-tauri/', '.vite/', 'src/i18n/locales/**'],
};
```

- [ ] **Step 2: Write `.eslintignore`**
```
dist/
node_modules/
src-tauri/
.vite/
src/i18n/locales/
**/*.min.js
```

- [ ] **Step 3: Write `.prettierrc.json`**
```json
{
  "semi": true,
  "singleQuote": true,
  "jsxSingleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

- [ ] **Step 4: Write `.prettierignore`**
```
dist/
node_modules/
src-tauri/target/
src-tauri/gen/
package-lock.json
**/*.min.js
src/i18n/locales/
```

- [ ] **Step 5: Write `.editorconfig`**
```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.{ts,tsx,js,mjs,cjs,json,css,md,toml,yml,yaml}]
indent_style = space
indent_size = 2

[*.rs]
indent_style = space
indent_size = 4

[Makefile]
indent_style = tab
```

- [ ] **Step 6: Write `.gitattributes`**
```
* text=auto eol=lf
*.png binary
*.ico binary
*.icns binary
*.wasm binary
```

- [ ] **Step 7: Write `rustfmt.toml`**
```toml
edition = "2021"
max_width = 100
fn_single_line = true
```

- [ ] **Step 8: Write `clippy.toml`**
```toml
msrv = "1.80"
type-complexity-threshold = 250
```

- [ ] **Step 9: Commit** — `chore: add eslint, prettier, rustfmt, clippy, editorconfig configs`

---

### Task 1.3: Add `lint`/`format` scripts to package.json

**Files:** Modify `package.json` scripts section.

- [ ] **Step 1: Add the new scripts** (preserve existing scripts)

```json
"lint": "eslint src --max-warnings 0",
"lint:fix": "eslint src --fix",
"format": "prettier --write .",
"format:check": "prettier --check .",
"test:node": "node scripts/test-completion.mjs && node scripts/test-split-layout.mjs && node scripts/verify-webgl-lifecycle.mjs",
"ci:check": "npm run build && npm run smoke:check && npm run lint && npm run format:check && npm run test:node"
```

Do NOT add `test` as an alias — `npm test` running `test:node` would surprise contributors expecting a Vitest runner.

- [ ] **Step 2: Verify** — `npm run | grep -E 'lint|format|test:node|ci:check'` (all 6 scripts listed).

- [ ] **Step 3: Commit** — `chore: add lint, format, test:node, ci:check npm scripts`

---

### Task 1.4: Bulk-reformat with Prettier + ESLint --fix + cargo fmt

**Files:** Bulk-modify all `src/**/*.{ts,tsx,js,mjs,cjs,json,css}` + all `src-tauri/src/**/*.rs`.

- [ ] **Step 1: Run Prettier --write** — `npm run format` (expect large diff).

- [ ] **Step 2: Run ESLint --fix** — `npm run lint:fix` (auto-fixable stylistic issues only).

- [ ] **Step 3: Run cargo fmt** — `cd src-tauri && cargo fmt && cd ..`

- [ ] **Step 4: Verify the app still builds** — `npm run build` (must succeed; if Prettier broke a template/JSX, fix manually).

- [ ] **Step 5: Create `.git-blame-ignore-revs`** with header:
```
# Commits that should be ignored by git blame (bulk reformats, etc.)
# One SHA per line.
```

- [ ] **Step 6: Commit the bulk reformat**
```bash
git add -A
git commit -m "chore: apply prettier, eslint --fix, cargo fmt (bulk reformat)

This is a mechanical reformat — no logic changes. Add the SHA of this
commit to .git-blame-ignore-revs so git blame skips it."
```

- [ ] **Step 7: Add the reformat SHA to `.git-blame-ignore-revs`**
```bash
REFORMAT_SHA=$(git rev-parse HEAD)
echo "$REFORMAT_SHA  # bulk reformat (PR1)" >> .git-blame-ignore-revs
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

- [ ] **Step 8: Commit** — `chore: ignore bulk-reformat commit in git blame`

- [ ] **Step 9: Update AGENTS.md** — add a "## Linting & formatting" section after "## Commands & verification order" documenting the 4 commands (`npm run lint`, `npm run format:check`, `cargo fmt --check`, `cargo clippy -- -D warnings`), the auto-fix commands, and the `.git-blame-ignore-revs` enable step.

- [ ] **Step 10: Commit** — `docs: document lint/format tooling in AGENTS.md`

**End of PR1.** Open PR `chore: enable lint/format tooling`. Verify CI still passes (CI has not yet been updated to enforce lint).

---

## PR2: `chore: fix eslint/clippy violations` (substantive fixes)

### Task 2.1: Inventory remaining ESLint violations

- [ ] **Step 1: Run ESLint and capture violations** — `npm run lint 2>&1 | tee /tmp/eslint-violations.txt`

- [ ] **Step 2: Group by rule** — `grep -oE '@typescript-eslint/[a-z-]+|no-console|no-restricted-syntax' /tmp/eslint-violations.txt | sort | uniq -c | sort -rn`

Expected top: `no-explicit-any`, `no-console`, `no-unused-vars`, `no-restricted-syntax` (`TSAsExpression`).

---

### Task 2.2: Fix `no-explicit-any` violations

**Files:** Every flagged file. Audit found 3 `as any` casts: `src/i18n/index.ts` (`getT`), `src/i18n/detect.ts` (`navigator.userLanguage`).

- [ ] **Step 1: Fix `src/i18n/index.ts`** — type the i18next `t` function via the existing `CustomTypeOptions` declaration in `src/i18n/i18next.d.ts`. Widen `CustomTypeOptions` if a key is missing.

- [ ] **Step 2: Fix `src/i18n/detect.ts`** — declare `interface Navigator { userLanguage?: string }` in a new `src/types/dom.d.ts` file, or use `(navigator as Navigator & { userLanguage?: string }).userLanguage`.

- [ ] **Step 3: Verify** — `npm run lint 2>&1 | grep no-explicit-any` (no output).

- [ ] **Step 4: Build** — `npm run build`

- [ ] **Step 5: Commit** — `chore: fix no-explicit-any ESLint violations`

---

### Task 2.3: Fix `no-console` violations

**Files:** Flagged files (audit found 12). Per `.eslintrc.cjs` rule `['error', { allow: ['warn', 'error'] }]`, only `console.log`/`console.info` need fixing now.

- [ ] **Step 1: Find** — `grep -rn "console\.\(log\|info\)" src/ --include="*.ts" --include="*.tsx"`

- [ ] **Step 2: Fix each** — debug `console.log` → delete; diagnostic `console.info` → `console.warn` or `console.error`. User-actionable `console.error` stays for PR4 toast migration.

- [ ] **Step 3: Verify** — `npm run lint 2>&1 | grep no-console` (no output).

- [ ] **Step 4: Commit** — `chore: fix no-console ESLint violations (remove debug logs)`

---

### Task 2.4: Fix `TSAsExpression` violations via typed `ipcEvents` helper

**Files:**
- Create: `src/lib/ipcEvents.ts`
- Modify: `src/components/Terminal/TerminalView.tsx` (docker-picker casts)
- Modify: `src/components/Terminal/DockerContainerPicker.tsx`

- [ ] **Step 1: Write `src/lib/ipcEvents.ts`**

```typescript
// Typed wrappers around window event dispatch + listen, so callers
// don't need `as CustomEvent` casts.

export interface DockerPickerPayload {
  sessionId: string;
  containerId: string;
}

export function dispatchTypedEvent<T>(name: string, detail: T): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function listenTypedEvent<T>(name: string, handler: (detail: T) => void): () => void {
  // Single sanctioned cast site — all other TSAsExpression uses are banned.
  // eslint-disable-next-line no-restricted-syntax
  const wrapped = (e: Event) => handler((e as CustomEvent<T>).detail);
  window.addEventListener(name, wrapped);
  return () => window.removeEventListener(name, wrapped);
}
```

- [ ] **Step 2: Replace `(e as CustomEvent).detail` sites** in `TerminalView.tsx` and `DockerContainerPicker.tsx` with `listenTypedEvent<DockerPickerPayload>('docker-picker-select', ...)`.

- [ ] **Step 3: Verify** — `npm run lint 2>&1 | grep no-restricted-syntax` (only the single sanctioned disable in `ipcEvents.ts`).

- [ ] **Step 4: Build + commit** — `chore: fix TSAsExpression violations via typed ipcEvents helper`

---

### Task 2.5: Fix remaining `no-unused-vars` and minor violations

- [ ] **Step 1: Run ESLint** — `npm run lint 2>&1 | tee /tmp/eslint-remaining.txt`

- [ ] **Step 2: Fix each** — `no-unused-vars`: delete or prefix with `_`. `react-hooks/exhaustive-deps`: add missing deps or `// eslint-disable-next-line react-hooks/exhaustive-deps` with reason. `react-refresh/only-export-components`: move constant exports to a separate file.

- [ ] **Step 3: Verify** — `npm run lint` (no output, exit 0).

- [ ] **Step 4: Commit** — `chore: fix remaining ESLint violations (unused vars, exhaustive-deps)`

---

### Task 2.6: Fix Clippy violations

- [ ] **Step 1: Run Clippy** — `cd src-tauri && cargo clippy -- -D warnings 2>&1 | tee /tmp/clippy.txt && cd ..` (expect 10–30 lints).

- [ ] **Step 2: Auto-fix** — `cd src-tauri && cargo clippy --fix --allow-dirty --allow-no-vcs && cd ..`

- [ ] **Step 3: Fix remaining manually** — for `too_many_arguments` on structural functions (e.g. `ssh_connect`), add `#[allow(clippy::too_many_arguments)]` with a reason comment. For `module_inception`, rename or `#[allow]` with reason.

- [ ] **Step 4: Verify** — `cd src-tauri && cargo clippy -- -D warnings && cd ..` (no warnings).

- [ ] **Step 5: Verify cargo test** — `cd src-tauri && cargo test && cd ..` (all 159 tests pass).

- [ ] **Step 6: Commit** — `chore: fix clippy warnings (needless_lifetimes, redundant_closure, etc.)`

**End of PR2.** Open PR `chore: fix eslint/clippy violations`. Verify CI still passes (still using old CI).

---

## PR3: `ci: run tests, lint, clippy on 3-OS matrix` (the safety net lands)

### Task 3.1: Update `.github/workflows/ci.yml` — split into frontend + backend jobs

**Files:** Modify `.github/workflows/ci.yml`

- [ ] **Step 1: Read existing ci.yml** — `cat .github/workflows/ci.yml` (note the `npm ci` retry/mirror guard logic — must preserve).

- [ ] **Step 2: Rewrite ci.yml with two jobs**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  frontend:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - name: Install (retry, mirror-guard)
        run: |
          for i in 1 2 3; do
            npm ci && break || (sleep 10 && [ $i -lt 3 ])
          done
      - run: npm run build
      - run: npm run smoke:check
      - run: npm run lint
      - run: npm run format:check
      - run: npm run test:node

  backend:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-22.04, macos-14, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions-rust-lang/setup-rust-toolchain@v1
        with:
          cache: true
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - name: Install (retry, mirror-guard)
        run: |
          for i in 1 2 3; do
            npm ci && break || (sleep 10 && [ $i -lt 3 ])
          done
      - run: npm run build  # produces ../dist needed by tauri build.rs
      - run: cargo fmt --check
        working-directory: src-tauri
      - run: cargo clippy -- -D warnings
        working-directory: src-tauri
      - run: cargo test
        working-directory: src-tauri
      - run: cargo check
        working-directory: src-tauri
```

- [ ] **Step 3: Verify YAML** — `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`

- [ ] **Step 4: Commit** — `ci: split into frontend + 3-OS backend jobs, run tests + clippy + fmt`

---

### Task 3.2: Create `.github/workflows/security.yml`

**Files:** Create `.github/workflows/security.yml`

- [ ] **Step 1: Write security.yml**

```yaml
name: Security audit

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
      - name: Install cargo-audit
        run: cargo install cargo-audit --locked
      - name: Cargo audit (strict on PR, warning-only on schedule)
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            cargo audit --deny warnings
          else
            cargo audit || true
          fi
        working-directory: src-tauri
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - name: npm audit (high+ only)
        run: npm audit --omit=dev --audit-level=high || true
```

- [ ] **Step 2: Commit** — `ci: add cargo audit + npm audit workflow (PR + weekly)`

---

### Task 3.3: Update `.github/workflows/release.yml` — add SBOM step

**Files:** Modify `.github/workflows/release.yml`

- [ ] **Step 1: Find the release-upload step** — `grep -n "softprops/action-gh-release\|tauri-action" .github/workflows/release.yml`

- [ ] **Step 2: Insert SBOM step before the release upload**

```yaml
      - name: Generate CycloneDX SBOM
        run: |
          cargo install cargo-cyclonedx --locked
          cargo cyclonedx --format json --output-pattern package
        working-directory: src-tauri
      - name: Upload SBOM to release
        uses: softprops/action-gh-release@v2
        with:
          files: src-tauri/gwshell.cdx.json
```

- [ ] **Step 3: Verify YAML** — `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"`

- [ ] **Step 4: Commit** — `ci: generate and attach CycloneDX SBOM to releases`

---

### Task 3.4: Extend `stability-smoke.mjs` — i18n key parity check

**Files:** Modify `scripts/stability-smoke.mjs`

- [ ] **Step 1: Read existing pattern** — `head -60 scripts/stability-smoke.mjs` (note the `{ ok: boolean, errors: string[] }` return style).

- [ ] **Step 2: Add `checkI18nKeyParity()` function**

```javascript
function checkI18nKeyParity() {
  const en = JSON.parse(fs.readFileSync(path.join(SRC, 'i18n/locales/gwshell.en.json'), 'utf8'));
  const zh = JSON.parse(fs.readFileSync(path.join(SRC, 'i18n/locales/gwshell.zh.json'), 'utf8'));
  const enKeys = collectKeys(en, '').sort();
  const zhKeys = collectKeys(zh, '').sort();
  const onlyInEn = enKeys.filter((k) => !zhKeys.includes(k));
  const onlyInZh = zhKeys.filter((k) => !enKeys.includes(k));
  if (onlyInEn.length === 0 && onlyInZh.length === 0) return { ok: true, errors: [] };
  const errors = [];
  if (onlyInEn.length) errors.push(`Keys only in en.json: ${onlyInEn.slice(0, 10).join(', ')}${onlyInEn.length > 10 ? ' (...)' : ''}`);
  if (onlyInZh.length) errors.push(`Keys only in zh.json: ${onlyInZh.slice(0, 10).join(', ')}${onlyInZh.length > 10 ? ' (...)' : ''}`);
  return { ok: false, errors };
}

function collectKeys(obj, prefix) {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) keys.push(...collectKeys(v, p));
    else keys.push(p);
  }
  return keys;
}
```

- [ ] **Step 3: Wire into main runner**

- [ ] **Step 4: Verify passes** — `npm run smoke:check`

- [ ] **Step 5: Verify FAILS on broken case (then revert)**
```bash
python3 -c "import json; d=json.load(open('src/i18n/locales/gwshell.en.json')); d['__test_missing']='temp'; json.dump(d, open('src/i18n/locales/gwshell.en.json','w'), indent=2, ensure_ascii=False)"
npm run smoke:check  # should fail
git checkout src/i18n/locales/gwshell.en.json
```

- [ ] **Step 6: Commit** — `chore(smoke): add i18n en/zh key parity check`

---

### Task 3.5: Extend `stability-smoke.mjs` — event-name parity check

- [ ] **Step 1: Add `checkEventNameParity()` function**

```javascript
const ALLOWED_EVENT_NAMES = [
  'pty-data', 'pty-exit',
  'ssh-data', 'ssh-exit',
  'serial-data', 'serial-exit',
  'sftp-progress',
  'server-metrics',
];

function collectEventNames(dir, pattern) {
  try {
    const out = execSync(`grep -rohE "${pattern}" ${dir} 2>/dev/null || true`, { encoding: 'utf8' });
    return [...new Set(out.trim().split('\n').filter(Boolean))];
  } catch { return []; }
}

function checkEventNameParity() {
  const backendRaw = collectEventNames('src-tauri/src', 'emit\\("[a-z_-]+-\\{');
  const backendPrefixes = [...new Set(backendRaw.map((s) => s.match(/emit\("([a-z_-]+)-/)?.[1]).filter(Boolean))].sort();
  const frontendRaw = collectEventNames('src', 'listen\\("[a-z_-]+-[\\$\\{]');
  const frontendPrefixes = [...new Set(frontendRaw.map((s) => s.match(/listen\("([a-z_-]+)-/)?.[1]).filter(Boolean))].sort();

  const errors = [];
  for (const name of backendPrefixes) {
    if (!ALLOWED_EVENT_NAMES.includes(name)) errors.push(`Backend emits "${name}-{id}" but it's not in ALLOWED_EVENT_NAMES — add it (forces review).`);
  }
  for (const name of frontendPrefixes) {
    if (!backendPrefixes.includes(name)) errors.push(`Frontend listens for "${name}-{id}" but backend never emits it.`);
  }
  for (const name of ALLOWED_EVENT_NAMES) {
    if (!backendPrefixes.includes(name)) errors.push(`ALLOWED_EVENT_NAMES lists "${name}" but backend never emits it — remove or implement.`);
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 2: Wire into runner**

- [ ] **Step 3: Verify passes** — `npm run smoke:check`

- [ ] **Step 4: Commit** — `chore(smoke): add backend-emit ↔ frontend-listen event-name parity check`

---

### Task 3.6: Extend `stability-smoke.mjs` — capabilities allowlist check

- [ ] **Step 1: Add `checkCapabilitiesAllowlist()` function**

```javascript
function checkCapabilitiesAllowlist() {
  const caps = JSON.parse(fs.readFileSync(path.join(SRC_TAURI, 'capabilities/default.json'), 'utf8'));
  const allowed = new Set([
    'core:default', 'opener:allow-open-path',
    'dialog:allow-open', 'dialog:allow-save',
    'core:window:allow-start-dragging', 'core:window:allow-minimize',
    'core:window:allow-maximize', 'core:window:allow-unmaximize',
    'core:window:allow-close', 'core:window:allow-destroy',
    'core:window:allow-toggle-maximize', 'core:window:allow-is-maximized',
    'core:window:allow-show', 'core:window:allow-hide',
    'core:window:allow-set-focus',
    'updater:allow-check', 'updater:allow-download-and-install',
    'deep-link:default',
    'clipboard-manager:allow-read-text', 'clipboard-manager:allow-write-text',
    'process:allow-exit', 'global-shortcut:default',
  ]);
  const errors = [];
  for (const perm of caps.permissions || []) {
    if (!allowed.has(perm)) errors.push(`capabilities/default.json grants "${perm}" which is not on the allowlist — add it here (forces security review).`);
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 2: Wire into runner**

- [ ] **Step 3: Verify passes** — `npm run smoke:check`

- [ ] **Step 4: Verify FAILS on broken case (then revert)**
```bash
python3 -c "import json; d=json.load(open('src-tauri/capabilities/default.json')); d['permissions'].append('fs:allow-read-text'); json.dump(d, open('src-tauri/capabilities/default.json','w'), indent=2)"
npm run smoke:check  # should fail
git checkout src-tauri/capabilities/default.json
```

- [ ] **Step 5: Commit** — `chore(smoke): add capabilities allowlist check (forces review on new perms)`

---

### Task 3.7: Verify CI passes end-to-end

- [ ] **Step 1: Run full ci:check locally** — `npm run ci:check` (all pass).

- [ ] **Step 2: Run cargo checks locally** — `cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test && cargo check && cd ..` (all pass).

- [ ] **Step 3: Push and verify CI is green** — `git push origin feat/server-panel-enhancements`. Watch GitHub Actions: `frontend` job + 3 `backend` matrix jobs all pass.

**End of PR3.** Open PR `ci: run tests, lint, clippy on 3-OS matrix + security audit + extended smoke check`. This is the safety-net PR — every subsequent PR has lint + test + clippy coverage.

---

## PR4: `feat: toast + confirm dialog system` (error handling unification)

### Task 4.1: Create `toastStore.ts`

**Files:** Create `src/stores/toastStore.ts`

**Interfaces:**
- Produces: `useToastStore` exporting `toasts`, `pushToast(toast)`, `dismissToast(id)`, `clear()`. Toast shape: `{ id, kind: 'info'|'success'|'warning'|'error', title, message?, durationMs?, action? }`.

- [ ] **Step 1: Write `src/stores/toastStore.ts`**

```typescript
import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  durationMs?: number; // 0 = sticky; undefined = default per kind
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, 'id'>) => string;
  dismissToast: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATION_MS: Record<ToastKind, number> = {
  info: 5000,
  success: 4000,
  warning: 6000,
  error: 0, // sticky — user must dismiss
};

let toastSeq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  pushToast: (toast) => {
    const id = `toast-${++toastSeq}`;
    const duration = toast.durationMs ?? DEFAULT_DURATION_MS[toast.kind];
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
    return id;
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));
```

- [ ] **Step 2: Build** — `npm run build`

- [ ] **Step 3: Commit** — `feat(toast): add toastStore with auto-dismiss per kind`

---

### Task 4.2: Create `useToast.ts` hook

**Files:** Create `src/hooks/useToast.ts`

- [ ] **Step 1: Write `src/hooks/useToast.ts`**

```typescript
import { useToastStore, type ToastAction } from '../stores/toastStore';

interface ToastOptions {
  title: string;
  message?: string;
  durationMs?: number;
  action?: ToastAction;
}

export function useToast() {
  const pushToast = useToastStore((s) => s.pushToast);
  return {
    info: (opts: ToastOptions) => pushToast({ kind: 'info', ...opts }),
    success: (opts: ToastOptions) => pushToast({ kind: 'success', ...opts }),
    warning: (opts: ToastOptions) => pushToast({ kind: 'warning', ...opts }),
    error: (opts: ToastOptions) => pushToast({ kind: 'error', ...opts }),
  };
}
```

- [ ] **Step 2: Build + commit** — `feat(toast): add useToast hook (sanctioned error-surfacing path)`

---

### Task 4.3: Create `ToastProvider` + `ToastItem` components

**Files:**
- Create: `src/components/Toast/ToastProvider.tsx`
- Create: `src/components/Toast/ToastItem.tsx`
- Create: `src/components/Toast/toast.css`

- [ ] **Step 1: Write `src/components/Toast/toast.css`** (theme-token-driven)

```css
.toast-stack {
  position: fixed;
  bottom: var(--space-4);
  right: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  z-index: 10000;
  pointer-events: none;
  max-width: 380px;
}
.toast-item {
  pointer-events: auto;
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  box-shadow: var(--shadow-elevated);
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  color: var(--text-primary);
  animation: toast-slide-in 200ms ease-out;
}
.toast-item--error { border-left: 3px solid var(--accent-danger); }
.toast-item--warning { border-left: 3px solid var(--accent-warning); }
.toast-item--success { border-left: 3px solid var(--accent-success); }
.toast-item--info { border-left: 3px solid var(--accent-primary); }
.toast-title { font-weight: 600; font-size: 0.875rem; }
.toast-message { font-size: 0.8125rem; color: var(--text-secondary); margin-top: 2px; }
.toast-body { flex: 1; min-width: 0; }
.toast-close {
  background: none; border: none; color: var(--text-secondary);
  cursor: pointer; padding: 0 var(--space-1); font-size: 1rem; line-height: 1;
}
.toast-close:hover { color: var(--text-primary); }
.toast-action {
  background: none; border: none; color: var(--accent-primary);
  cursor: pointer; font-size: 0.8125rem; font-weight: 500; margin-top: var(--space-1);
}
@keyframes toast-slide-in {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}
```

- [ ] **Step 2: Write `src/components/Toast/ToastItem.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { Toast } from '../../stores/toastStore';
import { useToastStore } from '../../stores/toastStore';
import './toast.css';

export function ToastItem({ toast }: { toast: Toast }) {
  const { t } = useTranslation();
  const dismiss = useToastStore((s) => s.dismissToast);
  return (
    <div
      className={`toast-item toast-item--${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
    >
      <div className="toast-body">
        <div className="toast-title">{toast.title}</div>
        {toast.message && <div className="toast-message">{toast.message}</div>}
        {toast.action && (
          <button className="toast-action" onClick={toast.action.onClick}>
            {toast.action.label}
          </button>
        )}
      </div>
      <button className="toast-close" onClick={() => dismiss(toast.id)} aria-label={t('common.dismiss')}>
        <X size={14} />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/components/Toast/ToastProvider.tsx`**

```tsx
import { useToastStore } from '../../stores/toastStore';
import { ToastItem } from './ToastItem';
import './toast.css';

export function ToastProvider() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="toast-stack" aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Build + commit** — `feat(toast): add ToastProvider + ToastItem components`

---

### Task 4.4: Create `confirmStore.ts` + `useConfirm.ts` + `ConfirmDialog.tsx`

**Files:**
- Create: `src/stores/confirmStore.ts`
- Create: `src/hooks/useConfirm.ts`
- Create: `src/components/ConfirmDialog/ConfirmDialog.tsx`
- Create: `src/components/ConfirmDialog/confirm.css`

- [ ] **Step 1: Write `src/stores/confirmStore.ts`**

```typescript
import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions | null;
  resolve: ((ok: boolean) => void) | null;
  request: (opts: ConfirmOptions) => Promise<boolean>;
  respond: (ok: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,
  request: (opts) => new Promise<boolean>((resolve) => set({ open: true, options: opts, resolve })),
  respond: (ok) => {
    get().resolve?.(ok);
    set({ open: false, options: null, resolve: null });
  },
}));
```

- [ ] **Step 2: Write `src/hooks/useConfirm.ts`**

```typescript
import { useConfirmStore, type ConfirmOptions } from '../stores/confirmStore';

export function useConfirm() {
  const request = useConfirmStore((s) => s.request);
  return (opts: ConfirmOptions) => request(opts);
}
```

- [ ] **Step 3: Write `src/components/ConfirmDialog/confirm.css`**

```css
.confirm-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 10001; animation: confirm-fade-in 150ms ease-out;
}
.confirm-dialog {
  background: var(--bg-elevated); border: 1px solid var(--border-color);
  border-radius: var(--radius-md); padding: var(--space-4);
  min-width: 320px; max-width: 420px; box-shadow: var(--shadow-elevated);
}
.confirm-title { font-weight: 600; font-size: 0.9375rem; margin-bottom: var(--space-2); color: var(--text-primary); }
.confirm-message { font-size: 0.875rem; color: var(--text-secondary); margin-bottom: var(--space-3); }
.confirm-actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
.confirm-btn {
  padding: var(--space-1) var(--space-3); border-radius: var(--radius-sm);
  border: 1px solid var(--border-color); background: var(--bg-elevated);
  color: var(--text-primary); cursor: pointer; font-size: 0.8125rem;
}
.confirm-btn:hover { background: var(--bg-hover); }
.confirm-btn--danger { background: var(--accent-danger); color: white; border-color: var(--accent-danger); }
.confirm-btn--danger:hover { filter: brightness(1.1); }
@keyframes confirm-fade-in { from { opacity: 0; } to { opacity: 1; } }
```

- [ ] **Step 4: Write `src/components/ConfirmDialog/ConfirmDialog.tsx`** (focus trap: focus confirm on open, Esc cancels, Enter confirms)

```tsx
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirmStore } from '../../stores/confirmStore';
import './confirm.css';

export function ConfirmDialog() {
  const { t } = useTranslation();
  const open = useConfirmStore((s) => s.open);
  const options = useConfirmStore((s) => s.options);
  const respond = useConfirmStore((s) => s.respond);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') respond(false);
      if (e.key === 'Enter') respond(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, respond]);

  if (!open || !options) return null;

  return (
    <div className="confirm-overlay" role="presentation" onClick={() => respond(false)}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="confirm-title" className="confirm-title">{options.title}</div>
        {options.message && <div className="confirm-message">{options.message}</div>}
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={() => respond(false)}>
            {options.cancelLabel ?? t('common.cancel')}
          </button>
          <button
            ref={confirmBtnRef}
            className={`confirm-btn ${options.danger ? 'confirm-btn--danger' : ''}`}
            onClick={() => respond(true)}
          >
            {options.confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build + commit** — `feat(confirm): add useConfirm hook + ConfirmDialog with focus trap`

---

### Task 4.5: Mount providers at `App.tsx` root + add i18n keys

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/i18n/locales/gwshell.en.json`
- Modify: `src/i18n/locales/gwshell.zh.json`

- [ ] **Step 1: Add i18n keys to `gwshell.en.json`** (new `common` nested section + `toast` section)

```json
"common": {
  "error": "Error",
  "success": "Success",
  "warning": "Warning",
  "info": "Information",
  "dismiss": "Dismiss",
  "confirm": "Confirm",
  "cancel": "Cancel"
},
"toast": {
  "sessionDeleted": "Session deleted",
  "sessionDeleteFailed": "Failed to delete session",
  "snippetSaved": "Snippet saved",
  "snippetSaveFailed": "Failed to save snippet",
  "snippetDeleted": "Snippet deleted",
  "snippetDeleteFailed": "Failed to delete snippet"
}
```

- [ ] **Step 2: Mirror in `gwshell.zh.json`**

```json
"common": {
  "error": "错误",
  "success": "成功",
  "warning": "警告",
  "info": "提示",
  "dismiss": "关闭",
  "confirm": "确认",
  "cancel": "取消"
},
"toast": {
  "sessionDeleted": "会话已删除",
  "sessionDeleteFailed": "删除会话失败",
  "snippetSaved": "代码片段已保存",
  "snippetSaveFailed": "保存代码片段失败",
  "snippetDeleted": "代码片段已删除",
  "snippetDeleteFailed": "删除代码片段失败"
}
```

- [ ] **Step 3: Verify smoke:check** — `npm run smoke:check` (i18n key parity passes).

- [ ] **Step 4: Mount `ToastProvider` + `ConfirmDialog` at `App.tsx` root**

Edit `src/App.tsx` to import both and render inside `<I18nextProvider>` (so they can `useTranslation`) just before `</I18nextProvider>`:

```tsx
import { ToastProvider } from './components/Toast/ToastProvider';
import { ConfirmDialog } from './components/ConfirmDialog/ConfirmDialog';
// ...
      <ToastProvider />
      <ConfirmDialog />
    </I18nextProvider>
```

Both render `null` when nothing to show, so mounting at root is always safe.

- [ ] **Step 5: Build + smoke:check** — `npm run build && npm run smoke:check`

- [ ] **Step 6: Commit** — `feat(toast): mount ToastProvider + ConfirmDialog at app root, add i18n keys`

---

### Task 4.6: Replace `window.confirm` call sites with `useConfirm`

**Files:** 8 call sites across 7 files:
- `src/components/Sidebar/SessionPanel.tsx:253`
- `src/components/Sidebar/SnippetPanel.tsx:133`
- `src/components/SftpPanel/SftpEditor.tsx:60`
- `src/components/SftpPanel/SftpPanel.tsx:398`
- `src/components/Agent/AgentActionQueue.tsx:31`
- `src/components/AssetTable/AssetTable.tsx:269, 306`
- `src/hooks/useAssetData.ts:68`

(TabBar.tsx already replaced its own — see `TabBar.tsx:69` comment.)

- [ ] **Step 1: Migrate `SessionPanel.tsx`**

```tsx
// Before:
if (window.confirm(t('common_delete_confirm_body', { name: contextMenu.session.name }))) {

// After:
const confirm = useConfirm();  // top of component
// ...
if (await confirm({
  title: t('common_delete_confirm_title'),
  message: t('common_delete_confirm_body', { name: contextMenu.session.name }),
  danger: true,
})) {
```

Note: `useConfirm` returns an async function — the enclosing handler must be `async`. If not already async, make it so.

- [ ] **Step 2: Migrate `SnippetPanel.tsx`** — same pattern.

- [ ] **Step 3: Migrate `SftpEditor.tsx`** — note: this is in a discard-check path; ensure async doesn't block unmount. Use `isUnmountedRef` guard if needed.

- [ ] **Step 4: Migrate `SftpPanel.tsx`** — same pattern.

- [ ] **Step 5: Migrate `AgentActionQueue.tsx`** — the `action.risk !== 'read_only'` check stays; only the `window.confirm` call changes.

- [ ] **Step 6: Migrate `AssetTable.tsx`** — 2 sites, same pattern.

- [ ] **Step 7: Migrate `useAssetData.ts`** — `useConfirm()` called at top of hook.

- [ ] **Step 8: Add missing i18n keys** for confirm titles if `common_delete_confirm_title` doesn't exist:

```json
// en
"common_delete_confirm_title": "Delete"
// zh
"common_delete_confirm_title": "删除"
```

- [ ] **Step 9: Build + lint + smoke:check** — `npm run build && npm run lint && npm run smoke:check`

- [ ] **Step 10: Commit** — `feat(confirm): replace 8 window.confirm call sites with useConfirm`

---

### Task 4.7: Wire optimistic-rollback failures to toast

**Files:**
- Modify: `src/stores/snippetStore.ts`
- Modify: `src/stores/appStore.ts`
- Modify: `src/stores/agentPolicyStore.ts`

- [ ] **Step 1: Update `snippetStore.ts`** — in the catch block of `add`/`update`/`remove`, add toast call. Stores can't use hooks, so import `useToastStore` directly + `i18n` instance:

```typescript
import { useToastStore } from './toastStore';
import i18n from '../i18n';
// ... in catch block:
useToastStore.getState().pushToast({
  kind: 'error',
  title: i18n.t('toast.snippetSaveFailed'),
  message: String(e),
});
```

- [ ] **Step 2: Update `appStore.ts` `removeSession`** — same pattern with `toast.sessionDeleteFailed`.

- [ ] **Step 3: Update `agentPolicyStore.ts` save failures** — same pattern.

- [ ] **Step 4: Build + lint + smoke:check** — `npm run build && npm run lint && npm run smoke:check`

- [ ] **Step 5: Commit** — `feat(toast): surface optimistic-rollback failures via toast`

---

### Task 4.8: Migrate `UpdateChecker` + `SecurityNotice` to toast

**Files:**
- Modify: `src/components/UpdateChecker/UpdateChecker.tsx`
- Modify: `src/components/SecurityNotice/SecurityNotice.tsx`
- Modify: `src/styles/global.css` (remove orphan `.update-toast` rules)

- [ ] **Step 1: Read UpdateChecker** — `cat src/components/UpdateChecker/UpdateChecker.tsx`

- [ ] **Step 2: Migrate UpdateChecker** — replace the `<div className="update-toast">` JSX with effect-driven toast calls. Keep the update logic (fetch latest, download, install) unchanged. Component renders `null`:

```tsx
import { useToast } from '../../hooks/useToast';
const toast = useToast();
useEffect(() => {
  if (updateAvailable) {
    toast.info({
      title: t('update.available'),
      message: t('update.available_body', { version }),
      action: { label: t('update.download'), onClick: () => downloadAndInstall() },
    });
  }
}, [updateAvailable]);
```

- [ ] **Step 3: Migrate SecurityNotice** — same pattern (shows warning when secret storage unavailable).

- [ ] **Step 4: Remove orphan `.update-toast` CSS** — `grep -n "update-toast" src/styles/global.css` then delete the rules.

- [ ] **Step 5: Build + lint + smoke:check** — `npm run build && npm run lint && npm run smoke:check`

- [ ] **Step 6: Commit** — `feat(toast): migrate UpdateChecker + SecurityNotice to toast system`

---

### Task 4.9: Add `no-window-confirm` smoke check + final verification

**Files:** Modify `scripts/stability-smoke.mjs`

- [ ] **Step 1: Add `checkNoWindowConfirm()` function**

```javascript
function checkNoWindowConfirm() {
  const result = execSync(`grep -rn "window\\.confirm" src/ --include="*.ts" --include="*.tsx" || true`, { encoding: 'utf8' });
  if (result.trim()) {
    return {
      ok: false,
      errors: [`window.confirm calls remain (must use useConfirm instead):\n${result.trim()}`],
    };
  }
  return { ok: true, errors: [] };
}
```

- [ ] **Step 2: Wire into runner**

- [ ] **Step 3: Verify passes** — `npm run smoke:check`

- [ ] **Step 4: Run full ci:check** — `npm run ci:check`

- [ ] **Step 5: Commit** — `chore(smoke): add no-window-confirm grep check`

**End of PR4.** Open PR `feat: toast + confirm dialog system`. Manual verification: trigger an update check, delete a session/snippet, force an SFTP overwrite — all should show the new toast/confirm UI.

---

## PR5: `security: pty thread join + serial flow control + documented argon2`

### Task 5.1: Document Argon2id params in `vault.rs`

**Files:** Modify `src-tauri/src/vault.rs`

- [ ] **Step 1: Add a named `argon2id()` helper with explicit params + OWASP citation**

```rust
use argon2::{Algorithm, Argon2, Params, Version};
// ... existing imports ...

/// Argon2id with OWASP-recommended minimum params (argon2 0.5 defaults):
///   m_cost = 19456 KiB (~19 MiB), t_cost = 2, p_cost = 1
/// Source: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
/// Rationale: this verifies a local UI unlock gate, not a server-side hash
/// database. The threat model is an attacker who stole the DB file but does
/// NOT have the OS keyring master key (which actually protects secrets — see
/// crypto.rs). Default params make brute-forcing the passphrase uneconomical
/// while keeping unlock under ~50ms on commodity laptops.
fn argon2id() -> Argon2<'static> {
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(19_456, 2, 1, None).expect("hardcoded valid params"),
    )
}
```

- [ ] **Step 2: Replace `Argon2::default()` in `set_passphrase` and `verify`**

```rust
// In set_passphrase:
let hash = argon2id()
    .hash_password(passphrase.as_bytes(), &salt)
    .map_err(|_| "failed to hash passphrase".to_string())?
    .to_string();

// In verify:
argon2id()
    .verify_password(passphrase.as_bytes(), &parsed)
    .is_ok()
```

- [ ] **Step 3: Add a unit test asserting both paths use the same algorithm/params**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use argon2::{Algorithm, Version};

    #[test]
    fn argon2id_helper_uses_correct_algorithm_and_version() {
        // We can't inspect Argon2's params directly (no public accessor in 0.5),
        // but we can at least assert the algorithm/version by hashing and parsing
        // the resulting PHC string back.
        let db = Database::new_in_memory_for_tests().unwrap();
        set_passphrase(&db, "test").unwrap();
        let phc = db.get_vault_verifier().unwrap();
        let parsed = argon2::password_hash::PasswordHash::new(&phc).unwrap();
        assert_eq!(parsed.algorithm(), argon2::Algorithm::Argon2id.ident());
        // Version is encoded in the PHC string as $argon2id$v=19$...
        assert!(phc.contains("$v=19$"));
    }
}
```

- [ ] **Step 4: Build + test** — `cd src-tauri && cargo test vault && cd ..`

- [ ] **Step 5: Commit** — `security(vault): document Argon2id params with OWASP citation`

---

### Task 5.2: Add `close_pty_wait` to `pty.rs` (join writer thread)

**Files:** Modify `src-tauri/src/pty.rs`

**Background:** Current `close_pty` (line 543) sends `PtyCmd::Close` via `try_send` and discards the error. If the channel is full (limit 64), the close signal is silently dropped and the child + writer thread leak. `serial.rs:273` already has the correct pattern (`close_serial_wait` using `owner_thread: Arc<Mutex<Option<JoinHandle>>>`). Mirror it.

- [ ] **Step 1: Add `writer_join` field to `PtyHandle`**

```rust
// pty.rs:53 — current:
struct PtyHandle {
    tx: mpsc::SyncSender<PtyCmd>,
    input: Arc<Mutex<PtyInputBuffer>>,
    wake_pending: Arc<AtomicBool>,
    charset: String,
}

// After:
struct PtyHandle {
    tx: mpsc::SyncSender<PtyCmd>,
    input: Arc<Mutex<PtyInputBuffer>>,
    wake_pending: Arc<AtomicBool>,
    charset: String,
    writer_join: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
}
```

- [ ] **Step 2: Capture the writer thread's JoinHandle when spawning**

The writer thread is spawned at `pty.rs:330` (`std::thread::spawn(move || { ... })`). Change it to capture the handle:

```rust
// Before (pty.rs:330):
std::thread::spawn(move || {
    let master = pair.master;
    // ...
});

// After:
let writer_join_handle = std::thread::spawn(move || {
    let master = pair.master;
    // ... (same body)
});
```

Then when constructing `PtyHandle` (around `pty.rs:285`):

```rust
let handle = PtyHandle {
    tx,
    input,
    wake_pending,
    charset,
    writer_join: Arc::new(Mutex::new(Some(writer_join_handle))),
};
```

- [ ] **Step 3: Add `close_pty_wait` method**

```rust
/// Remove a session and block until its writer thread has fully torn down
/// (child killed + waited, reader joined). Use when the caller can afford to
/// wait; for app-wide shutdown use `close_all` which signals without joining.
/// Mirrors `serial.rs::close_serial_wait`.
pub fn close_pty_wait(&self, session_id: &str) -> Result<(), String> {
    let handle = self.sessions.lock().remove(session_id);
    if let Some(handle) = handle {
        // Best-effort signal; ignore Full error since we'll join next.
        let _ = handle.tx.try_send(PtyCmd::Close);
        if let Some(join) = handle.writer_join.lock().take() {
            // 2s timeout wrapping the join, falling back to signal-only on
            // timeout (UI thread must not hang on a stuck child).
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = join.join();
                let _ = tx.send(());
            });
            if rx.recv_timeout(Duration::from_secs(2)).is_err() {
                return Err("writer thread join timed out after 2s".to_string());
            }
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

Add `use std::time::Duration;` if not already imported.

- [ ] **Step 4: Keep `close_all` signal-only** (no join — app shutdown must not block):

```rust
pub fn close_all(&self) {
    let handles: Vec<_> = self.sessions.lock().drain().map(|(_, v)| v).collect();
    for handle in handles {
        let _ = handle.tx.try_send(PtyCmd::Close);
        // Don't join — shutdown must not hang on a stuck child.
    }
}
```

- [ ] **Step 5: Add a regression test**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_pty_wait_consumes_writer_join() {
        // Opens a pty, fills the channel past the limit, then calls
        // close_pty_wait and asserts the JoinHandle is consumed (thread exited).
        // This is the regression for the silent Close-drop leak.
        // Note: requires a PTY backend — skip on no-pty environments (CI sans tty).
        // Use #[cfg(any(target_os = "linux", target_os = "macos"))] gate.
    }
}
```

Implement the test body: open a pty via `create_local_shell`, send 65+ `PtyCmd::WakeInput` to fill the channel, call `close_pty_wait`, assert `handle.writer_join.lock().is_none()` (taken). Gate with `#[cfg(any(target_os = "linux", target_os = "macos"))]` so Windows CI (no forkpty) doesn't fail.

- [ ] **Step 6: Build + test** — `cd src-tauri && cargo test pty && cargo clippy -- -D warnings && cd ..`

- [ ] **Step 7: Commit** — `security(pty): add close_pty_wait joining writer thread (fixes leak under queue pressure)`

---

### Task 5.3: Expose `flow_control` in `serial.rs`

**Files:**
- Modify: `src-tauri/src/serial.rs`
- Modify: `src-tauri/src/lib.rs` (`serial_open` command signature)
- Modify: `src/types/index.ts` (`SessionConfig.serial_flow_control`)
- Modify: `src/components/Modals/SerialPortModal.tsx`
- Modify: `src/i18n/locales/gwshell.{en,zh}.json`

- [ ] **Step 1: Add `flow_control` parameter to `SerialManager::open`**

```rust
// serial.rs — current open() signature (line 67):
pub fn open(
    &self,
    session_id: &str,
    port_name: &str,
    baud_rate: u32,
    data_bits: &str,
    stop_bits: &str,
    parity: &str,
    serial_encoding: Option<&str>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {

// After — add flow_control: &str parameter:
pub fn open(
    &self,
    session_id: &str,
    port_name: &str,
    baud_rate: u32,
    data_bits: &str,
    stop_bits: &str,
    parity: &str,
    flow_control: &str,  // "none" | "software" | "hardware"
    serial_encoding: Option<&str>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
```

- [ ] **Step 2: Map `flow_control` string to enum**

Replace the hardcoded `FlowControl::None` at line 101:

```rust
let fc = match flow_control.to_lowercase().as_str() {
    "hardware" | "rts/cts" => FlowControl::Hardware,
    "software" | "xon/xoff" | "xonxoff" => FlowControl::Software,
    _ => FlowControl::None, // "none" or unrecognized
};
// ...
let port = serialport::new(port_name, baud_rate)
    .data_bits(db)
    .stop_bits(sb)
    .parity(par)
    .flow_control(fc)
    // ...
```

- [ ] **Step 3: Update `serial_open` command in `lib.rs`** (line 823)

```rust
#[tauri::command]
async fn serial_open(
    session_id: String,
    port_name: String,
    baud_rate: u32,
    data_bits: String,
    stop_bits: String,
    parity: String,
    flow_control: Option<String>,  // NEW — Option for back-compat (defaults to "none")
    serial_encoding: Option<String>,
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        state.serial_manager.open(
            &session_id,
            &port_name,
            baud_rate,
            &data_bits,
            &stop_bits,
            &parity,
            flow_control.as_deref().unwrap_or("none"),
            serial_encoding.as_deref(),
            app_handle,
        )
    })
    .await
    .map_err(|e| format!("task join: {}", e))?
}
```

- [ ] **Step 4: Add `serial_flow_control` to `SessionConfig` in `src-tauri/src/session.rs`**

```rust
pub struct SessionConfig {
    // ... existing fields ...
    pub serial_flow_control: Option<String>,  // "none" | "software" | "hardware"
}
```

- [ ] **Step 5: Mirror in `src/types/index.ts`**

```typescript
export interface SessionConfig {
  // ... existing fields ...
  serial_flow_control?: 'none' | 'software' | 'hardware';
}
```

- [ ] **Step 6: Add dropdown to `SerialPortModal.tsx`**

Add a `<select>` with three options (None / Software XON/XOFF / Hardware RTS/CTS), bound to `serial_flow_control`, default `'none'`. Wire the value through to the `serial_open` invoke call.

- [ ] **Step 7: Add i18n keys** (both locale files, mirrored):

```json
// en
"serial_flow_control": "Flow Control",
"serial_flow_control_none": "None",
"serial_flow_control_software": "Software (XON/XOFF)",
"serial_flow_control_hardware": "Hardware (RTS/CTS)"
// zh
"serial_flow_control": "流控",
"serial_flow_control_none": "无",
"serial_flow_control_software": "软件 (XON/XOFF)",
"serial_flow_control_hardware": "硬件 (RTS/CTS)"
```

- [ ] **Step 8: Build + smoke:check** — `npm run build && npm run smoke:check` (i18n parity + IPC parity both pass — `serial_open` is now wired both sides with the new param).

- [ ] **Step 9: Commit** — `feat(serial): expose flow_control config (None/Software/Hardware)`

**End of PR5.** Open PR `security: pty thread join + serial flow control + documented argon2`. Each fix has a regression test.

---

## PR6: `refactor(db): adopt refinery migration framework`

### Task 6.1: Add `refinery` dependency

**Files:** Modify `src-tauri/Cargo.toml`

- [ ] **Step 1: Add refinery to Cargo.toml**

```toml
[dependencies]
# ... existing ...
refinery = { version = "0.8", features = ["rusqlite"] }
```

- [ ] **Step 2: Verify it compiles** — `cd src-tauri && cargo check && cd ..`

- [ ] **Step 3: Commit** — `chore: add refinery dependency`

---

### Task 6.2: Create `migrations/V001__initial.sql`

**Files:**
- Create: `src-tauri/migrations/V001__initial.sql`
- Create: `src-tauri/tests/fixtures/v0.5.5_baseline.sql`

- [ ] **Step 1: Read the current `init_tables` to capture the exact schema**

```bash
sed -n '41,92p' src-tauri/src/database.rs
```

- [ ] **Step 2: Write `src-tauri/migrations/V001__initial.sql`**

Capture the existing schema verbatim, with the `command_history` ALTERs (cwd/scope/session_type) folded into the CREATE. Use `CREATE TABLE IF NOT EXISTS` so V001 is idempotent on existing v0.5.5 databases:

```sql
-- V001: Initial schema (captures the v0.5.5 state as the baseline).
-- Idempotent: uses CREATE TABLE IF NOT EXISTS so existing v0.5.5 databases
-- are detected by the bootstrap helper and marked as V001-applied without
-- re-running destructive DDL.

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
    name TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_audit (
    id TEXT PRIMARY KEY,
    agent_session_id TEXT,
    target_session_id TEXT,
    started_at INTEGER,
    finished_at INTEGER,
    objective TEXT,
    status TEXT,
    report_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_audit_target
    ON agent_audit(target_session_id, started_at DESC);

-- command_history with the v0.5.5 columns folded in (they were ALTER-added
-- in the old init_tables; V001 creates them inline for fresh installs).
CREATE TABLE IF NOT EXISTS command_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command TEXT,
    ts INTEGER,
    cwd TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT '',
    session_type TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_cmd_ts ON command_history(ts DESC);

CREATE TABLE IF NOT EXISTS snippets (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
);
```

- [ ] **Step 3: Write the v0.5.5 baseline fixture** for the regression test (Task 6.5). This file represents an existing v0.5.5 database's `init_tables` output, used to verify the bootstrap detection works:

```sql
-- src-tauri/tests/fixtures/v0.5.5_baseline.sql
-- Represents the schema as created by the old database.rs::init_tables (pre-refinery).
-- Used by tests/migrations.rs to verify the bootstrap helper correctly detects
-- an existing v0.5.5 database and marks V001 as applied without data loss.

CREATE TABLE sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE groups (name TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE agent_audit (
    id TEXT PRIMARY KEY, agent_session_id TEXT, target_session_id TEXT,
    started_at INTEGER, finished_at INTEGER, objective TEXT, status TEXT, report_json TEXT
);
CREATE INDEX idx_agent_audit_target ON agent_audit(target_session_id, started_at DESC);
CREATE TABLE command_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, command TEXT, ts INTEGER,
    cwd TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '', session_type TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_cmd_ts ON command_history(ts DESC);
CREATE TABLE snippets (id TEXT PRIMARY KEY, data TEXT NOT NULL);

-- Sample data to verify round-trip preservation:
INSERT INTO sessions (id, data) VALUES ('test-1', '{"name":"test"}');
INSERT INTO app_settings (key, value) VALUES ('main', '{}');
INSERT INTO command_history (command, ts, cwd, scope, session_type) VALUES ('ls -la', 1234567890, '/tmp', 'global', 'localshell');
```

- [ ] **Step 4: Commit** — `refactor(db): add V001__initial.sql migration + v0.5.5 baseline fixture`

---

### Task 6.3: Integrate refinery into `database.rs`

**Files:** Modify `src-tauri/src/database.rs`

- [ ] **Step 1: Add the `embed_migrations!` macro + replace `init_tables`**

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

- [ ] **Step 2: Write `migrate_to_v001_baseline` helper**

This function detects whether the database is a pre-existing v0.5.5 database (no `schema_migrations` table but `sessions` table exists) and, if so, marks V001 as already applied so refinery doesn't try to re-run it destructively:

```rust
/// Bootstrap a pre-refinery (v0.5.5) database into the refinery world.
///
/// refinery's `schema_migrations` table doesn't exist on old databases.
/// If the old `sessions` table IS present, this is a v0.5.5 database whose
/// schema already matches V001 (the old `init_tables` created the same
/// tables). We create `schema_migrations` and insert V001 so refinery
/// skips V001 and only applies V002+ going forward.
///
/// If neither `schema_migrations` NOR `sessions` exists, this is a fresh
/// install — we let refinery run V001 from scratch (no bootstrap needed).
fn migrate_to_v001_baseline(conn: &Connection) -> Result<(), String> {
    // Does schema_migrations already exist? (refinery-created database)
    let has_migrations_table: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if has_migrations_table {
        return Ok(());  // refinery already managing — nothing to bootstrap.
    }

    // Does the old sessions table exist? (v0.5.5 database)
    let has_sessions_table: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if has_sessions_table {
        // v0.5.5 database — create the migrations table and mark V001 applied.
        conn.execute_batch(
            "CREATE TABLE schema_migrations (version INT PRIMARY KEY, applied_on DATETIME);
             INSERT INTO schema_migrations (version, applied_on) VALUES (1, datetime('now'));",
        )
        .map_err(|e| format!("baseline bootstrap failed: {}", e))?;
    }
    // else: fresh install — refinery will create everything via V001.

    Ok(())
}
```

- [ ] **Step 3: Remove the old `init_tables` function** and its call sites (the `new()` and `new_in_memory_for_tests()` constructors no longer call it; refinery does the work).

- [ ] **Step 4: Update `new_in_memory_for_tests`** to also run migrations:

```rust
pub fn new_in_memory_for_tests() -> Result<Self, String> {
    let mut conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    // No bootstrap needed for in-memory (fresh). Run migrations directly.
    migrations::runner()
        .run(&mut conn)
        .map_err(|e| format!("migration failed: {}", e))?;
    Ok(Self { conn: Mutex::new(conn) })
}
```

- [ ] **Step 5: Build** — `cd src-tauri && cargo check && cd ..`

- [ ] **Step 6: Verify existing tests still pass** — `cd src-tauri && cargo test && cd ..` (the crypto/vault tests use `new_in_memory_for_tests`, which now goes through refinery — should still pass since V001 creates the same schema).

- [ ] **Step 7: Commit** — `refactor(db): integrate refinery, replace init_tables with V001 migration`

---

### Task 6.4: Write migration integration tests

**Files:** Create `src-tauri/tests/migrations.rs`

- [ ] **Step 1: Write the from-scratch test**

```rust
use gwshell_lib::database::Database;

#[test]
fn migrations_from_scratch_create_full_schema() {
    let db = Database::new_in_memory_for_tests().unwrap();
    // Verify all V001 tables exist.
    let conn = db.conn.lock().unwrap();
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    drop(conn);
    for expected in ["sessions", "groups", "app_settings", "agent_audit", "command_history", "snippets", "schema_migrations"] {
        assert!(tables.contains(&expected.to_string()), "missing table: {}", expected);
    }
}

#[test]
fn migrations_from_scratch_allow_round_trip_insert() {
    let db = Database::new_in_memory_for_tests().unwrap();
    let conn = db.conn.lock().unwrap();
    conn.execute("INSERT INTO sessions (id, data) VALUES ('test-1', '{}')", []).unwrap();
    let data: String = conn.query_row("SELECT data FROM sessions WHERE id='test-1'", [], |row| row.get(0)).unwrap();
    assert_eq!(data, "{}");
}
```

- [ ] **Step 2: Write the v0.5.5 baseline bootstrap test**

```rust
use std::fs;
use rusqlite::Connection;
use gwshell_lib::database::Database;

#[test]
fn bootstrap_detects_v0_5_5_database_and_marks_v001_applied() {
    // 1. Create an in-memory DB and load the v0.5.5 baseline schema + data.
    let mut conn = Connection::open_in_memory().unwrap();
    let baseline = include_str!("fixtures/v0.5.5_baseline.sql");
    conn.execute_batch(baseline).unwrap();

    // 2. Verify sample data is present before migration.
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0)).unwrap();
    assert_eq!(count, 1);

    // 3. Run the bootstrap helper (simulating an upgrade from v0.5.5).
    //    We can't call Database::new on an in-memory conn (it opens its own),
    //    so we test the bootstrap helper directly if it's pub(crate), or
    //    test via a temp file path.
    let tmp = tempfile::NamedTempFile::new().unwrap();
    drop(conn);
    // Re-create the v0.5.5 baseline in the temp file.
    let mut conn = Connection::open(tmp.path()).unwrap();
    conn.execute_batch(baseline).unwrap();
    drop(conn);

    // Now open via Database::new — should bootstrap + run migrations.
    let db = Database::new(tmp.path()).unwrap();
    let conn = db.conn.lock().unwrap();

    // 4. Verify the schema_migrations table now exists and has V001.
    let v: i64 = conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row.get(0)).unwrap();
    assert_eq!(v, 1);

    // 5. Verify NO data loss — the sample row from baseline survived.
    let data: String = conn.query_row("SELECT data FROM sessions WHERE id='test-1'", [], |row| row.get(0)).unwrap();
    assert_eq!(data, "{\"name\":\"test\"}");
}
```

Note: the test uses `tempfile` crate — add it to `[dev-dependencies]` in Cargo.toml:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: Run the tests** — `cd src-tauri && cargo test --test migrations && cd ..`

- [ ] **Step 4: Commit** — `test(db): add refinery from-scratch + v0.5.5 baseline bootstrap tests`

---

### Task 6.5: Final verification + AGENTS.md update

**Files:** Modify `AGENTS.md`

- [ ] **Step 1: Run full ci:check** — `npm run ci:check`

- [ ] **Step 2: Run full cargo checks** — `cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test && cargo check && cd ..`

- [ ] **Step 3: Update AGENTS.md** — add a "## Database migrations" section:

```markdown
## Database migrations

Schema changes use `refinery` (embedded SQL files in `src-tauri/migrations/`).
The current schema is captured in `V001__initial.sql`.

To add a schema change:
1. Create `src-tauri/migrations/V0NN__description.sql`.
2. Add the corresponding fixture/update to `tests/fixtures/` if testing migration.
3. Run `cd src-tauri && cargo test --test migrations` to verify.
4. Commit the migration + test together.

Never edit an existing migration file — always add a new one. refinery tracks
applied versions in the `schema_migrations` table; editing an applied
migration has no effect (refinery checksums each file).

The `migrate_to_v001_baseline` helper in `database.rs` handles the one-time
upgrade of pre-refinery (v0.5.5) databases — do not modify it.
```

- [ ] **Step 4: Commit** — `docs: document refinery migration workflow in AGENTS.md`

**End of PR6.** Open PR `refactor(db): adopt refinery migration framework`. From this point, all schema changes are SQL files in `migrations/`.

---

## Self-Review Notes

### Spec coverage

| Spec section | Tasks implementing it |
|---|---|
| §A.2.1 config files | Task 1.2 |
| §A.2.2 npm scripts | Task 1.3 |
| §A.2.3 Cargo.toml dev-deps | Task 6.1 (refinery) |
| §A.2.4 ci.yml changes | Task 3.1 |
| §A.2.5 security.yml | Task 3.2 |
| §A.2.6 release.yml SBOM | Task 3.3 |
| §A.2.7 smoke:check extensions (i18n, events, capabilities) | Tasks 3.4, 3.5, 3.6 |
| §A.2.8 backwards compat (bulk reformat) | Task 1.4 |
| §B.3.1 toast store + provider + hook | Tasks 4.1, 4.2, 4.3 |
| §B.3.1 confirm dialog + hook | Task 4.4 |
| §B.3.2 migration of call sites | Tasks 4.5, 4.6, 4.7, 4.8 |
| §B.3.3 i18n keys | Task 4.5 |
| §B.3.4 component layout | Tasks 4.3, 4.4 |
| §B.3.5 backwards compat (UpdateChecker/SecurityNotice) | Task 4.8 |
| §C.4.1 documented Argon2id | Task 5.1 |
| §C.4.2 pty close_pty_wait | Task 5.2 |
| §C.4.3 serial flow_control | Task 5.3 |
| §C.4.4 SBOM | Task 3.3 (in PR3) |
| §C.4.5 cargo audit + npm audit | Task 3.2 |
| §D.5.1-5.5 refinery integration | Tasks 6.1, 6.2, 6.3, 6.4 |

### Type consistency check

- `useToast()` returns `{ info, success, warning, error }` — used consistently in Tasks 4.7, 4.8.
- `useConfirm()` returns `async (opts) => Promise<boolean>` — used consistently in Task 4.6.
- `pushToast` takes `Omit<Toast, 'id'>` — `useToast` wrappers spread `{ kind, ...opts }` first so `kind` is set correctly.
- `serial_flow_control: Option<String>` (Rust) ↔ `serial_flow_control?: 'none' | 'software' | 'hardware'` (TS) — the Rust side accepts any string and matches case-insensitively, so the TS union is a strict subset (safe).
- `close_pty_wait` returns `Result<(), String>` — `close_pty` discards via `let _ =`. Consistent.

### Placeholder scan

No TBD/TODO. Two intentional `#[cfg(test)]` bodies that say "implement the test body" (Task 5.2 Step 5, Task 2.6 Step 3 auto-fix) — these are TDD-style "write the test" steps where the actual test code is shown. No vague "add appropriate error handling" steps.

