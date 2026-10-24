#!/usr/bin/env node
// Local server: serves the pixel court UI, runs your real `claude` in a PTY,
// bridges it to the browser terminal over WebSocket, and receives Claude Code
// hook events (injected with `claude --settings <temp file>`). Binds to 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn as spawnChild } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import { listSessions } from './sessions.js';
import { sanitize } from './sanitize.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const HOOK = path.join(ROOT, 'server', 'hook.js');

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DEMO = flag('--demo');
const NO_OPEN = flag('--no-open') || process.env.COURT_NO_OPEN === '1';
const WANT_PORT = Number(opt('--port', process.env.COURT_PORT || 4747));
const DEFAULT_CWD = path.resolve(expandHome(opt('--cwd', process.env.INIT_CWD || process.cwd())));
const TOKEN = crypto.randomBytes(18).toString('hex');

function expandHome(p) {
  return typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? path.join(os.homedir(), p.slice(1)) : p;
}

// ---------- claude binary ----------
function findClaude() {
  if (process.env.COURT_CLAUDE_BIN) return process.env.COURT_CLAUDE_BIN;
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const n of names) {
      const p = path.join(dir, n);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {}
    }
  }
  const local = path.join(os.homedir(), '.local', 'bin', 'claude');
  return fs.existsSync(local) ? local : null;
}
const CLAUDE = findClaude();

// ---------- temp settings with hooks ----------
const HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'PermissionDenied', 'SubagentStart', 'SubagentStop', 'Notification',
  'Stop', 'StopFailure', 'SessionEnd',
];
let tmpDir = null;
let settingsPath = null;
let runtimePath = null;

function writeSettings(port) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eojeon-'));
  settingsPath = path.join(tmpDir, 'settings.json');
  const q = (s) => `"${s.replace(/"/g, '\\"')}"`;
  const command = `${q(process.execPath)} ${q(HOOK)} ${port} ${TOKEN}`;
  const hooks = {};
  for (const ev of HOOK_EVENTS) hooks[ev] = [{ hooks: [{ type: 'command', command, timeout: 5 }] }];
  fs.writeFileSync(settingsPath, JSON.stringify({ hooks }, null, 2), { mode: 0o600 });
  // lets `npm run fake-hooks` find this server (token stays on this machine, owner-only file)
  runtimePath = path.join(os.tmpdir(), `eojeon-${port}.json`);
  fs.writeFileSync(runtimePath, JSON.stringify({ port, token: TOKEN, hook: HOOK }), { mode: 0o600 });
}

function cleanup() {
  try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  try { if (runtimePath) fs.rmSync(runtimePath, { force: true }); } catch {}
}

// ---------- state ----------
let pty = null;
let ptyInfo = null; // { cwd, mode, sessionId, startedAt }
let outBuf = '';
const OUT_MAX = 256 * 1024;
const events = [];
const EV_MAX = 400;
let size = { cols: 100, rows: 30 };
const clients = new Set();

function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === 1) ws.send(s);
}

function pushEvent(ev) {
  events.push(ev);
  if (events.length > EV_MAX) events.splice(0, events.length - EV_MAX);
  broadcast({ t: 'event', ev });
}

function sysEvent(type, extra = {}) {
  pushEvent({ type, time: Date.now(), ...extra });
}

let ptyMod = null;
function loadPty() {
  if (!ptyMod) ptyMod = require('node-pty');
  return ptyMod;
}

function startClaude({ cwd, mode, sessionId, extraArgs }) {
  if (DEMO) throw new Error('데모 모드에서는 claude 를 띄우지 않습니다.');
  if (!CLAUDE) throw new Error('PATH 에서 claude 를 찾지 못했습니다. Claude Code 를 먼저 설치하세요.');
  const dir = path.resolve(expandHome(cwd || DEFAULT_CWD));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`폴더가 없습니다: ${dir}`);
  stopClaude();
  const args = ['--settings', settingsPath];
  if (mode === 'continue') args.push('--continue');
  else if (mode === 'resume') {
    if (sessionId) {
      if (!/^[0-9a-zA-Z-]{8,64}$/.test(sessionId)) throw new Error('세션 ID 형식이 이상합니다.');
      args.push('--resume', sessionId);
    } else args.push('--resume'); // Claude Code's own picker
  }
  if (Array.isArray(extraArgs)) for (const a of extraArgs) if (typeof a === 'string' && a) args.push(a);

  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '1' };
  // if this server itself was started from inside Claude Code, don't let the child think it's nested
  // (session-scoped markers only; user config such as CLAUDE_CODE_USE_BEDROCK is kept)
  for (const k of [
    'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID',
    'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_MESSAGING_SOCKET',
    'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_BRIDGE_SESSION_ID', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_PID', 'CLAUDE_EFFORT',
  ]) delete env[k];
  for (const k of Object.keys(env)) if (k.startsWith('npm_')) delete env[k];

  const { spawn } = loadPty();
  pty = spawn(CLAUDE, args, { name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd: dir, env });
  ptyInfo = { cwd: dir, folder: path.basename(dir), mode: mode || 'new', sessionId: sessionId || '', startedAt: Date.now(), pid: pty.pid };
  outBuf = '';
  const me = pty;
  pty.onData((d) => {
    outBuf += d;
    if (outBuf.length > OUT_MAX) outBuf = outBuf.slice(outBuf.length - OUT_MAX);
    broadcast({ t: 'out', d });
  });
  pty.onExit(({ exitCode, signal }) => {
    if (pty === me) {
      pty = null;
      broadcast({ t: 'exit', code: exitCode, signal });
      sysEvent('PtyExit', { code: exitCode });
    }
  });
  broadcast({ t: 'started', info: ptyInfo });
  sysEvent('PtyStart', { folder: ptyInfo.folder, mode: ptyInfo.mode });
}

function stopClaude() {
  if (pty) {
    const p = pty;
    pty = null;
    try { p.kill(); } catch {}
  }
}

// ---------- http ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const VENDOR = {
  '/vendor/xterm.js': () => require.resolve('@xterm/xterm/lib/xterm.js'),
  '/vendor/xterm.css': () => path.join(path.dirname(require.resolve('@xterm/xterm/package.json')), 'css', 'xterm.css'),
  '/vendor/addon-fit.js': () => require.resolve('@xterm/addon-fit/lib/addon-fit.js'),
  '/fonts/Galmuri11.woff2': () => path.join(path.dirname(require.resolve('galmuri/package.json')), 'dist', 'Galmuri11.woff2'),
  '/fonts/Galmuri11-Bold.woff2': () => path.join(path.dirname(require.resolve('galmuri/package.json')), 'dist', 'Galmuri11-Bold.woff2'),
  '/fonts/Galmuri9.woff2': () => path.join(path.dirname(require.resolve('galmuri/package.json')), 'dist', 'Galmuri9.woff2'),
  '/fonts/Galmuri7.woff2': () => path.join(path.dirname(require.resolve('galmuri/package.json')), 'dist', 'Galmuri7.woff2'),
  '/fonts/GalmuriMono11.woff2': () => path.join(path.dirname(require.resolve('galmuri/package.json')), 'dist', 'GalmuriMono11.woff2'),
};

let PORT = WANT_PORT;
function allowedHost(h) {
  return h === `localhost:${PORT}` || h === `127.0.0.1:${PORT}` || h === `[::1]:${PORT}`;
}
function allowedOrigin(o) {
  return o === `http://localhost:${PORT}` || o === `http://127.0.0.1:${PORT}` || o === `http://[::1]:${PORT}`;
}

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > max) {
        reject(new Error('too big'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'court.config.json'), 'utf8'));
}

const server = http.createServer(async (req, res) => {
  // DNS-rebinding guard: only answer to localhost names
  if (!allowedHost(req.headers.host || '')) {
    res.writeHead(403).end('forbidden host');
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === '/hook' && req.method === 'POST') {
    if (req.headers['x-court-token'] !== TOKEN) {
      res.writeHead(403).end();
      return;
    }
    try {
      const raw = JSON.parse(await readBody(req));
      // hook.js already trimmed it; sanitize-shape check again in case of a stray client
      const ev = raw && raw.type ? { ...raw, time: Date.now() } : sanitize(raw);
      pushEvent(ev);
      res.writeHead(204).end();
    } catch {
      res.writeHead(400).end();
    }
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }

  if (p === '/api/info') {
    return json(res, 200, {
      demo: DEMO, defaultCwd: DEFAULT_CWD, claudeFound: !!CLAUDE, running: !!pty, info: ptyInfo,
      home: os.homedir(), platform: process.platform,
    });
  }
  if (p === '/api/config') {
    try {
      return json(res, 200, loadConfig());
    } catch (e) {
      return json(res, 500, { error: 'court.config.json 을 읽지 못했습니다: ' + e.message });
    }
  }
  if (p === '/api/sessions') {
    const cwd = path.resolve(expandHome(url.searchParams.get('cwd') || DEFAULT_CWD));
    return json(res, 200, { cwd, sessions: listSessions(cwd, 30) });
  }
  if (VENDOR[p]) {
    try {
      return sendFile(res, VENDOR[p]());
    } catch {
      res.writeHead(404).end();
      return;
    }
  }
  const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  sendFile(res, file);
});

// ---------- websocket ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  // Cross-site WebSocket hijacking guard: a random web page must never be able to type into your terminal.
  if (!allowedHost(req.headers.host || '') || !allowedOrigin(req.headers.origin || '')) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ t: 'hello', demo: DEMO, running: !!pty, info: ptyInfo, history: events.slice(-200) }));
  if (pty && outBuf) ws.send(JSON.stringify({ t: 'out', d: outBuf, replay: true }));
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    switch (m.t) {
      case 'input':
        if (pty && typeof m.d === 'string') pty.write(m.d);
        break;
      case 'resize': {
        const cols = Math.max(20, Math.min(400, m.cols | 0));
        const rows = Math.max(5, Math.min(200, m.rows | 0));
        size = { cols, rows };
        if (pty) try { pty.resize(cols, rows); } catch {}
        break;
      }
      case 'start':
        try {
          startClaude(m);
        } catch (e) {
          ws.send(JSON.stringify({ t: 'error', message: e.message }));
        }
        break;
      case 'stop':
        stopClaude();
        break;
      default:
        break;
    }
  });
  ws.on('close', () => clients.delete(ws));
});

// ---------- boot ----------
function listen(port, tries = 10) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => {
      server.off('listening', onOk);
      if (e.code === 'EADDRINUSE' && tries > 0) resolve(listen(port + 1, tries - 1));
      else reject(e);
    };
    const onOk = () => {
      server.off('error', onErr);
      resolve(port);
    };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(port, '127.0.0.1');
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawnChild(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {}
}

PORT = await listen(WANT_PORT);
writeSettings(PORT);
const url = `http://localhost:${PORT}/${DEMO ? '?demo=1' : ''}`;
console.log(`\n  어전 · eojeon ${DEMO ? '(demo)' : ''}`);
console.log(`  ${url}`);
console.log(`  claude: ${CLAUDE || '(not found)'}   folder: ${DEFAULT_CWD}`);
console.log('  Everything stays on this machine (127.0.0.1). Ctrl+C to quit.\n');
if (!NO_OPEN) openBrowser(url);

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    stopClaude();
    cleanup();
    process.exit(0);
  });
}
process.on('exit', cleanup);
