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
  if (rt) {
    const r = await connect(rt, path.basename(cwd), cols, rows);
    ws = r.ws;
    if (!ws) console.error(`어전에 연결하지 못했습니다 (${r.why}). 그냥 claude 로 실행합니다.`);
  } else {
    console.error('어전이 꺼져 있습니다(npx eojeon-cli). 그냥 claude 로 실행합니다.');
  }
  const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));

  const claudeArgs = ws && rt.settings && fs.existsSync(rt.settings) ? ['--settings', rt.settings, ...args] : args;
  const { spawn } = loadPty();
  const pty = spawn(claude, claudeArgs, { name: 'xterm-256color', cols, rows, cwd, env: childEnv() });

  pty.onData((d) => {
    process.stdout.write(d);
    send({ t: 'tout', d });
  });
  if (ws) {
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'input' && typeof m.d === 'string') pty.write(m.d);
    });
    ws.on('close', () => {
      ws = null; // the court went away; keep working locally
    });
  }

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
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    try { ws?.close(); } catch {}
    process.exit(exitCode ?? 0);
  });
}
