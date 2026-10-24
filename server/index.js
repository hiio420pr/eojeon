#!/usr/bin/env node
// Local server: serves the pixel court UI, runs your real `claude` in a PTY,
// bridges it to the browser terminal over WebSocket, and receives Claude Code
// hook events (injected with `claude --settings <temp file>`). Binds to 127.0.0.1 only,
// unless started with --host (other devices, e.g. over Tailscale), which then requires an access key.
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
import { inspect as inspectAgents, install as installAgents, PACKS } from './agents.js';
import { HOOK_EVENTS, eojeonDir, runtimeFile } from './watch.js';

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
const HOST = opt('--host', process.env.COURT_HOST || '127.0.0.1');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const REMOTE = !LOOPBACK.has(HOST);
const TOKEN = crypto.randomBytes(18).toString('hex');
const KEY = REMOTE ? remoteKey(flag('--new-key')) : '';
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

// one key per machine, kept in ~/.eojeon/remote-key so a bookmarked address keeps working; --new-key rotates it
function remoteKey(rotate) {
  const file = path.join(eojeonDir(), 'remote-key');
  if (!rotate) {
    try {
      const k = fs.readFileSync(file, 'utf8').trim();
      if (/^[0-9a-f]{32,}$/.test(k)) return k;
    } catch {}
  }
  const k = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, k + '\n', { mode: 0o600 });
  return k;
}

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
  // lets `eojeon watch` hooks (sessions outside the court) find this server
  try {
    fs.mkdirSync(eojeonDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(runtimeFile(), JSON.stringify({ port, token: TOKEN, pid: process.pid }), { mode: 0o600 });
  } catch {}
}

function cleanup() {
  try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  try { if (runtimePath) fs.rmSync(runtimePath, { force: true }); } catch {}
  try {
    // only our own: a second court may have taken over the file
    if (JSON.parse(fs.readFileSync(runtimeFile(), 'utf8')).pid === process.pid) fs.rmSync(runtimeFile(), { force: true });
  } catch {}
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

// node-pty ships prebuilt binaries for macOS (arm64/x64) and Windows (x64/arm64).
// On Linux the prebuilt fork @homebridge/node-pty-prebuilt-multiarch is used instead.
// Both are optionalDependencies so `npx eojeon-cli` never fails to install (demo still works).
const PTY_MODULES = ['node-pty', '@homebridge/node-pty-prebuilt-multiarch'];
let ptyMod = null;
function loadPty() {
  if (ptyMod) return ptyMod;
  const errors = [];
  for (const name of PTY_MODULES) {
    try {
      ptyMod = require(name);
      return ptyMod;
    } catch (e) {
      errors.push(`${name}: ${String(e.message).split('\n')[0]}`);
    }
  }
  throw new Error(
    '터미널 모듈(node-pty)을 불러오지 못했습니다. `npm i -g eojeon` 으로 다시 설치하거나 빌드 도구(python3, make, C++ 컴파일러)를 설치해 주세요. ' +
      'Could not load node-pty. ' + errors.join(' | '),
  );
}

// `claude --help` → --permission-mode choices. bypassPermissions is left out on purpose:
// with it no petition ever reaches the court, and it skips every safety prompt.
export const PERMISSION_MODES = ['manual', 'acceptEdits', 'plan', 'auto', 'dontAsk'];

function startClaude({ cwd, mode, sessionId, permissionMode }) {
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
  if (permissionMode) {
    if (!PERMISSION_MODES.includes(permissionMode)) throw new Error(`권한 모드가 이상합니다: ${permissionMode}`);
    args.push('--permission-mode', permissionMode);
  }

  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '1' };
  // if this server itself was started from inside Claude Code, don't let the child think it's nested
  // (session-scoped markers only; user config such as CLAUDE_CODE_USE_BEDROCK is kept)
  for (const k of [
    'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID',
    'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_MESSAGING_SOCKET',
    'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_BRIDGE_SESSION_ID', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_PID', 'CLAUDE_EFFORT',
  ]) delete env[k];
  for (const k of Object.keys(env)) if (k.startsWith('npm_')) delete env[k];
  env.EOJEON_CHILD = '1'; // `eojeon watch` hooks skip this session (it already reports through --settings)

  const { spawn } = loadPty();
  pty = spawn(CLAUDE, args, { name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd: dir, env });
  ptyInfo = { cwd: dir, folder: path.basename(dir), mode: mode || 'new', sessionId: sessionId || '', permissionMode: permissionMode || '', startedAt: Date.now(), pid: pty.pid };
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
  '.png': 'image/png', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const VENDOR = {
  '/vendor/xterm.js': () => require.resolve('@xterm/xterm/lib/xterm.js'),
  '/vendor/xterm.css': () => path.join(path.dirname(require.resolve('@xterm/xterm/package.json')), 'css', 'xterm.css'),
  '/vendor/addon-fit.js': () => require.resolve('@xterm/addon-fit/lib/addon-fit.js'),
};

let PORT = WANT_PORT;
function allowedHost(h) {
  return h === `localhost:${PORT}` || h === `127.0.0.1:${PORT}` || h === `[::1]:${PORT}`;
}
function allowedOrigin(o) {
  return o === `http://localhost:${PORT}` || o === `http://127.0.0.1:${PORT}` || o === `http://[::1]:${PORT}`;
}
const fromLoopback = (req) => /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress || '');
function cookieKey(req) {
  const m = /(?:^|;\s*)eojeon_key=([0-9a-f]+)/.exec(req.headers.cookie || '');
  return m ? m[1] : '';
}
function keyOk(k) {
  return !!KEY && typeof k === 'string' && k.length === KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(KEY));
}
// Who may use the page and the terminal:
//  - this computer, under a localhost name (DNS-rebinding guard) — as before
//  - with --host: anyone holding the access key (cookie set from ?key=… on the first visit)
function access(req) {
  if (fromLoopback(req) && allowedHost(req.headers.host || '')) return 'local';
  if (REMOTE && keyOk(cookieKey(req))) return 'key';
  return '';
}
// same-origin check for anything that writes (terminal socket, agent install)
function sameOrigin(req, who) {
  const o = req.headers.origin || '';
  return who === 'local' ? allowedOrigin(o) : o === `http://${req.headers.host}`;
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

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === '/hook' && req.method === 'POST') {
    // hooks always run on this computer
    if (!fromLoopback(req) || req.headers['x-court-token'] !== TOKEN) {
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

  let who = access(req);
  if (!who && REMOTE && req.method === 'GET' && keyOk(url.searchParams.get('key'))) {
    // first visit from another device: trade the key in the address for a cookie, then drop it from the address bar
    url.searchParams.delete('key');
    res.writeHead(302, {
      'set-cookie': `eojeon_key=${KEY}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 30}`,
      location: url.pathname + url.search,
      'cache-control': 'no-store',
    });
    res.end();
    return;
  }
  if (!who) {
    // DNS-rebinding guard: only localhost names, or the access key with --host
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end(
      REMOTE ? 'forbidden — 어전을 켠 터미널에 찍힌 주소(?key=…)로 한 번 열어 주세요' : 'forbidden host',
    );
    return;
  }

  if (p === '/api/agents/install' && req.method === 'POST') {
    // writes files: only from our own page (same-origin fetch always sends Origin) and only JSON
    if (!sameOrigin(req, who) || !/^application\/json/.test(req.headers['content-type'] || '')) {
      res.writeHead(403).end();
      return;
    }
    try {
      const { cwd, pack } = JSON.parse(await readBody(req, 4096));
      if (!['yukjo', 'studio', 'all'].includes(pack || 'yukjo')) throw new Error(`pack: ${PACKS.join(' | ')} | all`);
      const r = installAgents(path.resolve(expandHome(cwd || DEFAULT_CWD)), pack || 'yukjo');
      return json(res, 200, r);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }

  if (p === '/api/info') {
    return json(res, 200, {
      app: 'eojeon', version: VERSION,
      demo: DEMO, defaultCwd: DEFAULT_CWD, claudeFound: !!CLAUDE, running: !!pty, info: ptyInfo,
      home: os.homedir(), platform: process.platform, permissionModes: PERMISSION_MODES, remote: REMOTE,
    });
  }
  if (p === '/api/config') {
    try {
      return json(res, 200, loadConfig());
    } catch (e) {
      return json(res, 500, { error: 'court.config.json 을 읽지 못했습니다: ' + e.message });
    }
  }
  if (p === '/api/agents') {
    const cwd = path.resolve(expandHome(url.searchParams.get('cwd') || DEFAULT_CWD));
    if (!fs.existsSync(cwd)) return json(res, 200, { cwd, folderMissing: true });
    try {
      return json(res, 200, { cwd, ...inspectAgents(cwd, 'yukjo'), studio: inspectAgents(cwd, 'studio').missing.length === 0 });
    } catch (e) {
      return json(res, 500, { error: e.message });
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
}

// ---------- websocket ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
function onUpgrade(req, socket, head) {
  // Cross-site WebSocket hijacking guard: a random web page must never be able to type into your terminal.
  const who = access(req);
  if (!who || !sameOrigin(req, who)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
}
function makeServer() {
  const s = http.createServer(handle);
  s.on('upgrade', onUpgrade);
  return s;
}
// always on 127.0.0.1 (hooks post there); with --host also on that address unless it already covers loopback
const server = makeServer();
const WILDCARD = HOST === '0.0.0.0' || HOST === '::';

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
    server.listen(port, WILDCARD ? HOST : '127.0.0.1');
  });
}

function listenAlso(port) {
  return new Promise((resolve, reject) => {
    const s = makeServer();
    s.once('error', reject);
    s.listen(port, HOST, () => resolve(s));
  });
}

// addresses another device can use: Tailscale (100.64.0.0/10), LAN, and this computer's name
function remoteUrls(port) {
  const out = [];
  if (!WILDCARD) out.push(HOST);
  else {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
    out.push(os.hostname().replace(/\.local$/, ''));
  }
  const ts = (a) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a);
  return [...new Set(out)]
    .sort((a, b) => ts(b) - ts(a))
    .map((h) => `http://${h.includes(':') ? `[${h}]` : h}:${port}/?key=${KEY}${ts(h) ? '   (Tailscale)' : ''}`);
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawnChild(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {}
}

PORT = await listen(WANT_PORT);
if (REMOTE && !WILDCARD) {
  try {
    await listenAlso(PORT);
  } catch (e) {
    console.error(`  --host ${HOST}: ${e.message}`);
    process.exit(1);
  }
}
writeSettings(PORT);
const url = `http://localhost:${PORT}/${DEMO ? '?demo=1' : ''}`;
console.log(`\n  어전 · eojeon ${VERSION} ${DEMO ? '(demo)' : ''}`);
console.log(`  ${url}`);
console.log(`  claude: ${CLAUDE || '(not found)'}   folder: ${DEFAULT_CWD}`);
if (REMOTE) {
  console.log(`\n  다른 기기에서 (--host ${HOST}) — 처음 한 번은 키가 붙은 주소로 여세요:`);
  for (const u of remoteUrls(PORT)) console.log(`    ${u}`);
  console.log('  ! 이 키를 가진 사람은 이 컴퓨터의 claude 터미널을 쓸 수 있습니다. 믿는 기기에서만 여세요. 키 바꾸기: --new-key');
  console.log('  Ctrl+C to quit.\n');
} else {
  console.log('  Everything stays on this machine (127.0.0.1). Ctrl+C to quit.\n');
}
if (!NO_OPEN) openBrowser(url);

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    stopClaude();
    cleanup();
    process.exit(0);
  });
}
process.on('exit', cleanup);
