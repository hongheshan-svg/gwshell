/**
 * Runtime verification of the WebGL terminal lifecycle alignment with VSCode.
 *
 * NOT a rendering test (that needs a GPU/WebGL canvas). It verifies the
 * runtime API CONTRACT our wiring depends on really exists on the shipped
 * addon (events are instance accessors created in the constructor, not on
 * the prototype), and that our wiring code is present in the built bundle.
 * This closes the gap between "the typings say these events exist" and
 * "they really do at runtime" — a check a static tsc/smoke gate can't provide.
 *
 * Run: node scripts/verify-webgl-lifecycle.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log('  ✓', msg);
  else {
    console.error('  ✗', msg);
    failures++;
  }
};

console.log('GWShell WebGL lifecycle alignment verification\n');

// ── 1. The shipped WebglAddon exposes every event we wire ──────────────
// The event accessors (onContextLoss, onChangeTextureAtlas, ...) are created
// as INSTANCE fields in the constructor (via xterm's Emitter), not on the
// prototype. The constructor takes only options (no terminal needed), so we
// can instantiate it and inspect the live instance.
console.log('[1] WebglAddon runtime API surface');
const { WebglAddon } = require('@xterm/addon-webgl');
const addon = new WebglAddon({ customGlyphs: true });
assert(typeof addon.dispose === 'function', 'WebglAddon.dispose() exists');
for (const ev of [
  'onContextLoss',
  'onChangeTextureAtlas',
  'onAddTextureAtlasCanvas',
  'onRemoveTextureAtlasCanvas',
]) {
  const val = addon[ev];
  assert(
    typeof val === 'function',
    `WebglAddon.${ev} is wired (instance event accessor present, typeof ${typeof val})`,
  );
}
try {
  addon.dispose();
} catch {}

// ── 2. The xterm Terminal exposes clearTextureAtlas + refresh ─────────
console.log('\n[2] xterm Terminal runtime API surface');
const { Terminal } = require('@xterm/xterm');
const tproto = Terminal.prototype;
assert(
  typeof tproto.clearTextureAtlas === 'function',
  'Terminal.clearTextureAtlas() exists (theme-switch fix depends on it)',
);
assert(typeof tproto.refresh === 'function', 'Terminal.refresh() exists');
assert(typeof tproto.dispose === 'function', 'Terminal.dispose() exists');

// ── 3. Our wiring code is present in the built bundle ──────────────────
console.log('\n[3] Built-bundle wiring presence');
const distDir = `${root}/dist/assets`;
const indexFiles = existsSync(distDir)
  ? readdirSync(distDir).filter((f) => f.startsWith('index-') && f.endsWith('.js'))
  : [];
if (indexFiles.length === 0) {
  console.log('  (skip) dist/ not present — run `npm run build` first');
} else {
  let blob = '';
  for (const f of indexFiles) blob += readFileSync(`${distDir}/${f}`, 'utf8');
  assert(blob.includes('customGlyphs'), 'WebglAddon({ customGlyphs: true }) instantiation present');
  assert(blob.includes('onChangeTextureAtlas'), 'onChangeTextureAtlas wiring present');
  assert(blob.includes('onAddTextureAtlasCanvas'), 'onAddTextureAtlasCanvas wiring present');
  assert(blob.includes('onRemoveTextureAtlasCanvas'), 'onRemoveTextureAtlasCanvas wiring present');
  assert(blob.includes('gwshell:webgl-debug'), 'dev-gated observability flag present');
  assert(blob.includes('smoothScrollDuration'), 'smoothScrollDuration option present');
  assert(blob.includes('color-scheme change'), 'color-scheme change atlas-clear trace present');
  assert(blob.includes('app theme change'), 'app-theme change atlas-clear trace present');
}

// ── 4. TerminalInstance registry tracks atlas canvases ────────────────
console.log('\n[4] Registry tracks texture atlas canvases');
const regSrc = readFileSync(`${root}/src/components/Terminal/terminalRegistry.ts`, 'utf8');
assert(
  regSrc.includes('textureAtlasCanvases?: HTMLCanvasElement[]'),
  'TerminalInstance.textureAtlasCanvases field declared',
);
assert(
  /onChangeTextureAtlas[\s\S]{0,400}onAddTextureAtlasCanvas[\s\S]{0,400}onRemoveTextureAtlasCanvas/.test(
    regSrc,
  ),
  'registry comment documents all three atlas events',
);

console.log('\n' + (failures === 0 ? 'Result: PASS' : `Result: FAIL (${failures} assertion(s))`));
process.exit(failures === 0 ? 0 : 1);
