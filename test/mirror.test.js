import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const BIN = new URL('../cli/eojeon.js', import.meta.url).pathname;

function open(port, origin = `http://localhost:${port}`) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { headers: { origin } });
  const msgs = [];
  ws.on('message', (m) => msgs.push(JSON.parse(m.toString())));
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve({ ws, msgs }));
    ws.on('error', reject);
  });
}
const until = async (fn) => {
  for (let i = 0; i < 40; i++) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  return fn();
};

test('eojeon claude mirror: screen goes to the browser, browser input comes back', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'eojeon-home-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [BIN, '--port', String(port), '--no-open'], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: 'ignore',
  });
  try {
    const rtFile = path.join(home, '.eojeon', 'runtime.json');
    await until(() => fs.existsSync(rtFile));
    await new Promise((r) => setTimeout(r, 200));
    const rt = JSON.parse(fs.readFileSync(rtFile, 'utf8'));
    assert.ok(rt.settings && fs.existsSync(rt.settings), 'runtime.json points at the hook settings');

    // wrong token is refused
    const bad = await open(port);
    bad.ws.send(JSON.stringify({ t: 'attach', token: 'nope', folder: 'x', cols: 80, rows: 24 }));
    assert.ok(await until(() => bad.msgs.find((m) => m.t === 'error')));

    const browser = await open(port);
    const term = await open(port);
    term.ws.send(JSON.stringify({ t: 'attach', token: rt.token, folder: 'proj', cols: 90, rows: 20 }));
    assert.ok(await until(() => term.msgs.find((m) => m.t === 'attached')));
    const started = await until(() => browser.msgs.find((m) => m.t === 'started'));
    assert.deepEqual(started.size, { cols: 90, rows: 20 });

    term.ws.send(JSON.stringify({ t: 'tout', d: 'hello from my terminal' }));
    assert.ok(await until(() => browser.msgs.find((m) => m.t === 'out' && m.d === 'hello from my terminal')));

    browser.ws.send(JSON.stringify({ t: 'input', d: '1' }));
    assert.ok(await until(() => term.msgs.find((m) => m.t === 'input' && m.d === '1')));

    // a browser that connects later gets the screen so far
    const late = await open(port);
    assert.ok(await until(() => late.msgs.find((m) => m.t === 'out' && m.replay && m.d.includes('hello from my terminal'))));

    term.ws.close();
    assert.ok(await until(() => browser.msgs.find((m) => m.t === 'exit' && m.mirror)));
    for (const c of [bad, browser, late]) c.ws.close();
  } finally {
    child.kill();
  }
});
