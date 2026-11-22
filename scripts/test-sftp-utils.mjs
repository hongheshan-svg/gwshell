#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const nodeRequire = createRequire(import.meta.url);

function loadTs(rel, requireMap = {}) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const m = { exports: {} };
  new Function('exports', 'require', 'module', js)(
    m.exports,
    (s) => (s in requireMap ? requireMap[s] : nodeRequire(s)),
    m,
  );
  return m.exports;
}

const { isTextFile, formatSize, formatPermissions } = loadTs('src/lib/sftpUtils.ts');
const { buildDockerHost } = loadTs('src/lib/terminalConnectors.ts', {
  './tempSecrets': { getTempPassword: () => undefined },
});

// isTextFile handles uppercase special filenames, dotfiles, extensions, and binaries
assert.equal(isTextFile('Makefile'), true, 'Makefile');
assert.equal(isTextFile('Dockerfile'), true, 'Dockerfile');
assert.equal(isTextFile('.bashrc'), true, 'dotfile');
assert.equal(isTextFile('nginx.conf'), true, 'extension');
assert.equal(isTextFile('archive.tar.gz'), false, 'binary archive');
assert.equal(isTextFile('photo.png'), false, 'binary image');

// formatPermissions preserves leading zeros and special bits (setuid/setgid/sticky)
assert.equal(formatPermissions(null), '', 'null perm');
assert.equal(formatPermissions(0o100644), '644', 'standard 644');
assert.equal(formatPermissions(0o100077), '077', 'leading zero preserved');
assert.equal(formatPermissions(0o104755), '4755', 'setuid bit preserved');

// formatSize
assert.equal(formatSize(0), '-');
assert.equal(formatSize(512), '512B');
assert.equal(formatSize(2048), '2.0KB');

// buildDockerHost
assert.equal(buildDockerHost(undefined), null);
assert.equal(
  buildDockerHost({ docker_protocol: 'unix', docker_unix_path: '/var/run/docker.sock' }),
  'unix:///var/run/docker.sock',
);
assert.equal(
  buildDockerHost({ docker_protocol: 'tcp', docker_unix_path: '10.0.0.5:2375' }),
  'tcp://10.0.0.5:2375',
);
assert.equal(
  buildDockerHost({ docker_protocol: 'tcp', docker_unix_path: 'https://docker.internal:2376' }),
  'https://docker.internal:2376',
);

console.log('sftp utils and connector tests passed');
