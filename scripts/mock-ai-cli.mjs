#!/usr/bin/env node
/**
 * Mock AI CLI for Auto Mode testing.
 *
 * Usage: node scripts/mock-ai-cli.mjs [mode]
 *   modes:
 *     3opt   - default. Emits Claude-Code-style 3-option approval prompt in alt-screen.
 *     2opt   - Claude-Code-style 2-option prompt (Yes / No).
 *     yn     - Generic "(y/N)" shell-style prompt in alt-screen.
 *     loop   - Re-emits the prompt every 1s after receiving a keystroke. Good for cooldown test.
 *
 * The script enters alt-screen (\x1b[?1049h) so the AutoModeWatcher's alt-screen gate applies.
 * Press Ctrl+C to exit (normal screen is restored).
 */

const mode = process.argv[2] || '3opt';
const ENTER_ALT = '\x1b[?1049h';
const EXIT_ALT = '\x1b[?1049l';
const CLEAR = '\x1b[2J\x1b[H';

const prompts = {
  '3opt':
`Do you want to make this edit to file.py?

❯ 1. Yes
  2. Yes, and don't ask again this session
  3. No, and tell Claude what to do differently
`,
  '2opt':
`Do you want to proceed?

❯ 1. Yes
  2. No
`,
  'yn': `Apply these changes? [y/N] `,
};

let counter = 0;

function emitPrompt() {
  const text = prompts[mode === 'loop' ? '3opt' : mode] || prompts['3opt'];
  process.stdout.write(CLEAR + text + `\n(attempt ${++counter})\n`);
}

process.stdout.write(ENTER_ALT);
emitPrompt();

process.stdin.setRawMode?.(true);
process.stdin.resume();

process.stdin.on('data', (chunk) => {
  const got = chunk.toString('utf8').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  process.stdout.write(CLEAR + `Received: ${JSON.stringify(got)}\n`);

  if (mode === 'loop') {
    setTimeout(emitPrompt, 300);
    return;
  }
  setTimeout(() => {
    process.stdout.write(EXIT_ALT);
    process.exit(0);
  }, 400);
});

const cleanup = () => {
  try { process.stdout.write(EXIT_ALT); } catch {}
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
