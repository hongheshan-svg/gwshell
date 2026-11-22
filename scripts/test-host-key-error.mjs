#!/usr/bin/env node
// Unit tests for src/lib/hostKeyError.ts (parses the Rust backend's
// `FINGERPRINT_*:{json}` host-key rejection strings).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const nodeRequire = createRequire(import.meta.url);
function loadTs(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const m = { exports: {} };
  new Function('exports', 'require', 'module', js)(m.exports, nodeRequire, m);
  return m.exports;
}
const { parseHostKeyError } = loadTs('src/lib/hostKeyError.ts');

const payload = (extra = {}) =>
  JSON.stringify({
    fingerprint: 'SHA256:abc:def',
    keyType: 'ssh-ed25519',
    knownKeyType: null,
    host: 'jump.example',
    port: 2222,
    ...extra,
  });

// Unknown host: fingerprint containing ':' survives (old split(':') parser broke on it).
assert.deepEqual(parseHostKeyError(`FINGERPRINT_UNKNOWN:${payload()}`), {
  kind: 'unknown',
  fingerprint: 'SHA256:abc:def',
  keyType: 'ssh-ed25519',
  knownKeyType: null,
  host: 'jump.example',
  port: 2222,
});

// Mismatch, wrapped in another error message.
assert.equal(
  parseHostKeyError(`SSH connect failed: FINGERPRINT_MISMATCH:${payload()}`)?.kind,
  'mismatch',
);

// Key type changed carries the previously pinned type.
const changed = parseHostKeyError(
  `FINGERPRINT_KEYTYPE_CHANGED:${payload({ keyType: 'ssh-rsa', knownKeyType: 'ssh-ed25519' })}`,
);
assert.equal(changed?.kind, 'keytype_changed');
assert.equal(changed?.knownKeyType, 'ssh-ed25519');
assert.equal(changed?.keyType, 'ssh-rsa');

// Anything else (or malformed payloads) is not a host-key error.
assert.equal(parseHostKeyError('Authentication failed'), null);
assert.equal(parseHostKeyError('FINGERPRINT_UNKNOWN:not json'), null);
assert.equal(parseHostKeyError('FINGERPRINT_UNKNOWN:{"keyType":"x"}'), null);

console.log('host-key error parser tests passed');
