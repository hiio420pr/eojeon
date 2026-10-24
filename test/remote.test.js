import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const BIN = new URL('../cli/eojeon.js', import.meta.url).pathname;

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return null;
}

function get(host, port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host, port, path: p, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    }).on('error', reject);
  });
}

async function start(args, home) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [BIN, '--port', String(port), '--no-open', ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  for (let i = 0; i < 50 && !out.includes('Ctrl+C'); i++) await new Promise((r) => setTimeout(r, 100));
  return { child, port, out: () => out };
}

test('default: other devices are refused, runtime file is written for watch hooks', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'eojeon-home-'));
  const { child, port } = await start([], home);
  try {
    assert.equal((await get('127.0.0.1', port, '/api/info')).statusCode, 200);
    assert.equal((await get('127.0.0.1', port, '/api/info', { host: 'macmini:' + port })).statusCode, 403);
    const rt = JSON.parse(fs.readFileSync(path.join(home, '.eojeon', 'runtime.json'), 'utf8'));
    assert.equal(rt.port, port);
  } finally {
    child.kill();
  }
});

test('--host 0.0.0.0: key in the address → cookie; without it 403', { skip: !lanAddress() && 'no LAN address' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'eojeon-home-'));
  const { child, port, out } = await start(['--host', '0.0.0.0'], home);
  const ip = lanAddress();
  try {
    const key = fs.readFileSync(path.join(home, '.eojeon', 'remote-key'), 'utf8').trim();
    assert.ok(out().includes(`?key=${key}`));
    assert.equal((await get(ip, port, '/api/info')).statusCode, 403);
    assert.equal((await get(ip, port, '/api/info?key=wrong')).statusCode, 403);
    const r = await get(ip, port, `/?key=${key}`);
    assert.equal(r.statusCode, 302);
    assert.equal(r.headers.location, '/');
    const cookie = r.headers['set-cookie'][0].split(';')[0];
    assert.equal((await get(ip, port, '/api/info', { cookie })).statusCode, 200);
    // this computer still works without a key
    assert.equal((await get('127.0.0.1', port, '/api/info')).statusCode, 200);
  } finally {
    child.kill();
  }
});
