// `eojeon claude [claude args…]`: run claude in *this* terminal and mirror it into the running court.
// The screen is copied to the browser as it is drawn, and whatever is typed in the browser
// (or a 윤허/불허 stamp) goes into this claude too. Without a running court it is plain claude.
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { runtimeFile } from './watch.js';
import { findClaude, loadPty, childEnv } from './pty.js';

function readRuntime() {
  try {
    const rt = JSON.parse(fs.readFileSync(runtimeFile(), 'utf8'));
    process.kill(rt.pid, 0); // still alive?
    return rt;
  } catch {
    return null;
  }
}

function connect(rt, folder, cols, rows) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${rt.port}/`, { headers: { origin: `http://127.0.0.1:${rt.port}` } });
    const fail = (why) => {
      try { ws.close(); } catch {}
      resolve({ ws: null, why });
    };
    const timer = setTimeout(() => fail('timeout'), 3000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'attach', token: rt.token, folder, cols, rows })));
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'attached') {
        clearTimeout(timer);
        resolve({ ws });
      } else if (m.t === 'error') {
        clearTimeout(timer);
        fail(m.message);
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      fail(e.message);
    });
  });
}

export async function run(args) {
  const claude = findClaude();
  if (!claude) {
    console.error('claude 를 찾지 못했습니다. Claude Code 를 먼저 설치하세요.');
    process.exit(1);
  }
  const cwd = process.cwd();
  let cols = process.stdout.columns || 100;
  let rows = process.stdout.rows || 30;

  const rt = readRuntime();
  let ws = null;
  let pty = null;
  const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));

  // (re)connect to the court; when it is busy or off, keep trying quietly so the mirror starts as soon as it can
  let connecting = false;
  async function tryAttach() {
    if (ws || connecting) return;
    const now = readRuntime();
    if (!now) return;
    connecting = true;
    const r = await connect(now, path.basename(cwd), cols, rows);
    connecting = false;
    if (!r.ws) return;
    ws = r.ws;
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'input' && typeof m.d === 'string' && pty) pty.write(m.d);
    });
    ws.on('close', () => {
      ws = null;
    });
    // make claude redraw its whole screen so the court sees it from the top
    if (pty) {
      try {
        pty.resize(cols, Math.max(5, rows - 1));
        setTimeout(() => { try { pty.resize(cols, rows); } catch {} }, 80);
      } catch {}
    }
  }

  if (rt) {
    await tryAttach();
    if (!ws) console.error('어전이 바쁘거나 응답이 없습니다. claude 를 먼저 띄우고, 어전이 비면 자동으로 연결합니다.');
  } else {
    console.error('어전이 꺼져 있습니다(npx eojeon-cli). 어전을 켜면 자동으로 연결합니다.');
  }
  const retry = setInterval(tryAttach, 3000);
  retry.unref?.();

  // hooks: the court's settings when known (they find the court through the token in that file)
  const settings = (readRuntime() || {}).settings;
  const claudeArgs = settings && fs.existsSync(settings) ? ['--settings', settings, ...args] : args;
  const { spawn } = loadPty();
  pty = spawn(claude, claudeArgs, { name: 'xterm-256color', cols, rows, cwd, env: childEnv() });

  pty.onData((d) => {
    process.stdout.write(d);
    send({ t: 'tout', d });
  });

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => pty.write(d));
  process.stdin.resume();
  process.stdout.on('resize', () => {
    cols = process.stdout.columns;
    rows = process.stdout.rows;
    try { pty.resize(cols, rows); } catch {}
    send({ t: 'tsize', cols, rows });
  });

  pty.onExit(({ exitCode }) => {
    clearInterval(retry);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    try { ws?.close(); } catch {}
    process.exit(exitCode ?? 0);
  });
}
