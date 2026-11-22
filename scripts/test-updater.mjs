import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = process.cwd();

function loadTs(relPath) {
  const source = fs.readFileSync(path.join(root, relPath), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };

  const exports = {};
  const module = { exports };
  const context = vm.createContext({
    exports,
    module,
    localStorage,
    console,
  });
  vm.runInContext(transpiled, context, { filename: relPath });
  return module.exports;
}

const u = loadTs('src/lib/updaterUtils.ts');

// 1. Progress percentage clamping & unknown total handling
assert.equal(u.computeDownloadProgress(0, 0), null);
assert.equal(u.computeDownloadProgress(500, 0), null);
assert.equal(u.computeDownloadProgress(0, 1000), 0);
assert.equal(u.computeDownloadProgress(250, 1000), 25);
assert.equal(u.computeDownloadProgress(1500, 1000), 100);

// 2. Byte formatting
assert.equal(u.formatUpdateBytes(0), '0 B');
assert.equal(u.formatUpdateBytes(512), '512 B');
assert.equal(u.formatUpdateBytes(1536), '1.5 KB');
assert.equal(u.formatUpdateBytes(10 * 1024 * 1024), '10.0 MB');

// 3. Release date formatting
assert.equal(u.formatReleaseDate(''), '');
assert.equal(u.formatReleaseDate('2026-11-22T10:15:00Z'), '2026-11-22');

// 4. Error normalization
assert.equal(u.normalizeUpdateError(new Error('network timeout')), 'network timeout');
assert.equal(u.normalizeUpdateError('manifest 404'), 'manifest 404');
assert.equal(u.normalizeUpdateError(null), 'Unknown updater error');

// 5. Skipped version persistence
assert.equal(u.getDismissedVersion(), null);
u.setDismissedVersion('0.7.0');
assert.equal(u.getDismissedVersion(), '0.7.0');
u.clearDismissedVersion();
assert.equal(u.getDismissedVersion(), null);

// 6. Tauri config & capabilities OTA invariants (prevents regression of relaunch permission)
const caps = JSON.parse(
  fs.readFileSync(path.join(root, 'src-tauri/capabilities/default.json'), 'utf8'),
);
for (const required of [
  'updater:allow-check',
  'updater:allow-download-and-install',
  'process:allow-restart',
]) {
  assert.ok(
    caps.permissions.includes(required),
    `capabilities/default.json missing required OTA permission: ${required}`,
  );
}

const tauriConf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
assert.equal(tauriConf.bundle?.createUpdaterArtifacts, true, 'createUpdaterArtifacts must be true');
assert.ok(
  typeof tauriConf.plugins?.updater?.pubkey === 'string' &&
    tauriConf.plugins.updater.pubkey.length > 20,
  'updater pubkey must be configured',
);
assert.ok(
  Array.isArray(tauriConf.plugins?.updater?.endpoints) &&
    tauriConf.plugins.updater.endpoints.some((e) => e.endsWith('/latest.json')),
  'updater endpoints must include latest.json',
);

const releaseYml = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
assert.ok(
  releaseYml.includes('includeUpdaterJson: true'),
  'release.yml must enable includeUpdaterJson',
);
assert.ok(
  releaseYml.includes('TAURI_SIGNING_PRIVATE_KEY'),
  'release.yml must pass TAURI_SIGNING_PRIVATE_KEY',
);
assert.ok(
  releaseYml.includes('**/*.exe.sig'),
  'release.yml must upload Windows v2 .exe.sig artifacts',
);
assert.ok(
  releaseYml.includes('**/*.AppImage.sig'),
  'release.yml must upload Linux v2 .AppImage.sig artifacts',
);

console.log('updater utils & OTA invariants tests passed');
