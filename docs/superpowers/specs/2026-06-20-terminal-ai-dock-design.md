# Terminal AI Dock Design

## Goal

Add a terminal-native AI entry point: a small intelligent terminal button in the lower-right corner of the terminal, opening a bottom dock for manual AI-assisted troubleshooting.

## Interaction

- Default state: show a compact AI terminal icon at the lower-right of the terminal area.
- Expanded state: show a bottom overlay dock anchored inside the terminal container.
- The dock does not resize the xterm instance and does not write AI responses into shell output.
- The dock shows current terminal context chips, including the active path and prompt when known.
- The dock supports two primary modes:
  - Execute: send the typed text to the active terminal as manual command input.
  - Agent: send the typed question plus terminal context to the configured AI provider and stream the answer in the dock.

## Context

The AI request should include:

- Current active tab metadata.
- Selected terminal text when available.
- Recent terminal output when no selection exists.
- Current working directory and prompt, when the terminal has detected them.

The first implementation should keep context capture bounded and redacted by the existing backend prompt/redaction path where possible.

## Safety

- AI responses are advisory only.
- No AI answer is auto-executed.
- Suggested commands remain user-controlled: user can copy, edit, or run them manually.
- The dock uses the existing saved AI provider settings and API key. If unavailable, it shows a local error and links the user toward Agent / AI settings.

## Components

- `TerminalAiDock`: terminal overlay UI and input state.
- `terminalContext`: lightweight shared terminal context registry for prompt, cwd, selected text, and recent output.
- Backend IPC: a manual AI chat command that streams via the existing provider layer.

## Verification

- TypeScript build must pass.
- Rust check and relevant agent/provider tests must pass.
- Smoke check must pass.
- Manual verification: open terminal, click the AI button, send a question, receive streamed response without terminal output pollution.
