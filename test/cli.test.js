import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const BIN = new URL('../cli/eojeon.js', import.meta.url).pathname;
const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 10000 });
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('--help prints usage and exits 0', () => {
  const r = run('--help');
  assert.equal(r.status, 0);
  for (const s of ['eojeon demo', 'eojeon init', '--pack', '--port', '--version']) assert.ok(r.stdout.includes(s), s);
});

test('--version prints the package version', () => {
  const r = run('--version');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), pkg.version);
});

test('unknown command exits non-zero', () => {
  assert.notEqual(run('frobnicate').status, 0);
});

test('init <dir> reports added and skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eojeon-cli-'));
  const a = run('init', dir);
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /added\s+\(6\)/);
  const b = run('init', dir, '--pack', 'yukjo');
  assert.match(b.stdout, /skipped \(6\)/);
  assert.notEqual(run('init', dir, '--pack', 'bogus').status, 0);
});
