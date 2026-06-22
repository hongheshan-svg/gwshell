# Terminal AI Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lower-right terminal AI icon that opens a bottom dock for manual AI-assisted terminal troubleshooting.

**Architecture:** Add a small frontend dock inside `TerminalContainer`, backed by a lightweight terminal context registry and a new backend manual AI chat IPC. Reuse the existing AI provider streaming implementation and keep AI output out of the terminal shell buffer.

**Tech Stack:** React, Zustand-adjacent module state, Tauri IPC, Rust async provider streaming, existing i18n and CSS.

---

## File Structure

- Create `src/components/Terminal/TerminalAiDock.tsx`: floating icon, bottom dock UI, execute/agent actions.
- Create `src/lib/terminalContext.ts`: shared context registry for cwd, prompt, selection, and recent output.
- Modify `src/components/Terminal/TerminalContainer.tsx`: mount the dock inside terminal containers.
- Modify `src/components/Terminal/TerminalView.tsx`: publish terminal selection, cwd, prompt, and recent output into the registry.
- Modify `src-tauri/src/agent/types.rs`: add manual AI chat request struct.
- Modify `src-tauri/src/agent/prompt.rs`: add manual terminal chat prompt builder and tests.
- Modify `src-tauri/src/lib.rs`: add `run_terminal_ai_chat` IPC command and register it.
- Modify `src/types/agent.ts`: add frontend manual chat request type.
- Modify `src/i18n/locales/gwshell.en.json` and `src/i18n/locales/gwshell.zh.json`: add UI labels.
- Modify `src/styles/global.css`: add terminal AI dock styles.

## Task 1: Backend Manual AI Chat

**Files:**
- Modify: `src-tauri/src/agent/types.rs`
- Modify: `src-tauri/src/agent/prompt.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] Add a failing Rust test for manual terminal chat prompt content in `src-tauri/src/agent/prompt.rs`.
- [ ] Run `cargo test terminal_ai --lib` and verify the test fails because the prompt builder is missing.
- [ ] Add `TerminalAiChatRequest` to `agent/types.rs`.
- [ ] Implement `build_terminal_ai_chat_prompt` in `agent/prompt.rs`.
- [ ] Add `run_terminal_ai_chat` in `lib.rs`, loading saved provider settings and API key, streaming deltas through Tauri events.
- [ ] Register `run_terminal_ai_chat` in `tauri::generate_handler`.
- [ ] Run `cargo test terminal_ai --lib` and `cargo check`.

## Task 2: Terminal Context Registry

**Files:**
- Create: `src/lib/terminalContext.ts`
- Modify: `src/components/Terminal/TerminalView.tsx`

- [ ] Create typed context setters/getters for `cwd`, `prompt`, `selection`, and bounded recent output.
- [ ] Wire terminal selection changes to `setTerminalSelection`.
- [ ] Wire OSC cwd detection to `setTerminalCwd`.
- [ ] Capture recent output from terminal data events with a bounded character limit.
- [ ] Clear terminal context on `destroyTerminal`.

## Task 3: Terminal AI Dock UI

**Files:**
- Create: `src/components/Terminal/TerminalAiDock.tsx`
- Modify: `src/components/Terminal/TerminalContainer.tsx`
- Modify: `src/types/agent.ts`
- Modify: i18n locale files
- Modify: `src/styles/global.css`

- [ ] Add dock collapsed icon at the lower-right of the terminal container.
- [ ] Add expanded bottom dock with context chips, textarea, Execute, Agent, Background, Add model, refresh, and safety buttons.
- [ ] Implement Execute by sending text to the active terminal through `sendInputToTab`.
- [ ] Implement Agent by invoking `run_terminal_ai_chat` and listening to scoped stream events.
- [ ] Keep AI answer inside the dock and never write it to terminal output.
- [ ] Show clear errors for missing active terminal, missing provider, or missing API key.

## Task 4: Verification

**Files:**
- All modified files.

- [ ] Run `cargo fmt`.
- [ ] Run `cargo test --lib`.
- [ ] Run `cargo check`.
- [ ] Run `npm run build`.
- [ ] Run `npm run smoke:check`.
- [ ] Run `git diff --check`.
- [ ] Run `npm run tauri dev` and confirm the app starts for manual testing.

## Self-Review

- Spec coverage: covers floating icon, bottom dock, context chips, Execute/Agent split, safe non-execution AI behavior, and verification.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: frontend and backend request names are aligned around terminal AI chat.
