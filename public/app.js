import { Court, W, H } from './scene.js';
import { runDemo } from './demo.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const [config, info] = await Promise.all([
  fetch('/api/config').then((r) => r.json()),
  fetch('/api/info').then((r) => r.json()).catch(() => ({ demo: true })),
]);
const DEMO = info.demo || params.get('demo') === '1';

// ---------- branding from config ----------
document.title = config.name || document.title;
$('appName').textContent = config.name || '';
$('appSub').textContent = config.tagline || config.subtitle || '';
const root = document.documentElement.style;
for (const [k, v] of Object.entries(config.palette || {})) if (!k.startsWith('_')) root.setProperty(`--${k}`, v);
for (const k of ['hong', 'cheong', 'nok', 'inju', 'paper']) if (config.pixel?.[k]) root.setProperty(`--px-${k}`, config.pixel[k]);

// ---------- terminal ----------
const term = new window.Terminal({
  fontFamily: 'Menlo, Monaco, "D2Coding", "Apple SD Gothic Neo", "Noto Sans Mono CJK KR", monospace',
  fontSize: 13,
  lineHeight: 1.1,
  cursorBlink: true,
  scrollback: 5000,
  allowProposedApi: true,
  macOptionIsMeta: true,
  theme: {
    background: config.palette.paper,
    foreground: config.palette.ink,
    cursor: config.palette.hwang,
    selectionBackground: '#3A3F4A',
  },
});
const fit = new window.FitAddon.FitAddon();
term.loadAddon(fit);
term.open($('term'));

let ws = null;
let running = false;
const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));
const sendInput = (d) => (DEMO ? null : send({ t: 'input', d }));

function doFit() {
  try {
    fit.fit();
    send({ t: 'resize', cols: term.cols, rows: term.rows });
  } catch {}
}
new ResizeObserver(() => doFit()).observe($('term'));
term.onData((d) => {
  sendInput(d);
  // answered the permission dialog directly in the terminal: Esc = refused
  if (d === '\x1b' && court.petition && !court.petition.closed) {
    court.closePetition('no');
    addLog({ type: 'Verdict', time: Date.now(), verdict: 'no' });
  }
});

// ---------- stage scaling (integer when big enough, so pixels stay square) ----------
const stageWrap = document.querySelector('.stage-wrap');
const stage = $('stage');
const canvas = $('scene');
const overlay = $('overlay');
function scaleStage() {
  const r = stageWrap.getBoundingClientRect();
  let s = Math.min(r.width / W, r.height / H);
  if (s >= 2) s = Math.floor(s);
  s = Math.max(0.5, s);
  stage.style.width = `${W * s}px`;
  stage.style.height = `${H * s}px`;
  canvas.style.width = `${W * s}px`;
  canvas.style.height = `${H * s}px`;
  overlay.style.transform = `scale(${s})`;
  overlay.style.transformOrigin = '0 0';
}
new ResizeObserver(scaleStage).observe(stageWrap);
scaleStage();

// ---------- court ----------
const court = new Court({
  canvas,
  overlay,
  config,
  onPetitionAction: (kind) => {
    const keys = config.permissionKeys || {};
    const k = keys[kind];
    if (k) sendInput(k);
    addLog({ type: 'Verdict', time: Date.now(), verdict: kind });
    term.focus();
  },
});

// ---------- 사관 일지 (event log) ----------
const logEl = $('log');
const ph = config.phrases || {};
const officials = config.officials || {};
const guests = config.guests || {};
const titleOf = (t) => (!t ? officials.main.title : officials[t]?.title || guests[t]?.title || `${guests['*']?.title || '관리'}(${t})`);
const fmt = (tpl, v) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (v[k] == null ? '' : v[k]));
const byTool = new Map();
let lastAsk = 0;

function logLine(ev) {
  const who = titleOf(ev.agentType);
  switch (ev.type) {
    case 'PtyStart': return ['sys', '·', `claude 를 띄웠습니다 · ${ev.folder} (${{ new: '새 조회', continue: '이어서', resume: '세션 이어받기' }[ev.mode] || ev.mode})`];
    case 'PtyExit': return ['sys', '·', `claude 가 끝났습니다 (code ${ev.code})`];
    case 'SessionStart':
      if (ev.source === 'clear') return ['sys', '·', '조정을 새로 엽니다 (/clear)'];
      if (ev.source === 'compact') return ['sys', '·', '기록을 줄였사옵니다 (compact)'];
      return ['sys', '開', fmt(ev.source === 'resume' || ev.source === 'fork' ? ph.sessionResume : ph.sessionStart, { folder: ev.folder || '' })];
    case 'UserPromptSubmit': return ['decree', '敎', `교지: ${ev.prompt || ''}`];
    case 'PreToolUse': return ['tool', '筆', `${who} · ${ev.tool}${ev.summary ? ': ' + ev.summary : ''}`];
    case 'PostToolUseFailure': return ['fail', '×', `${who} · ${fmt(ph.failed, { tool: ev.tool })}`];
    case 'PermissionRequest': lastAsk = ev.time; return ['ask', '?', `${who} · ${ph.permission} — ${ev.tool}${ev.summary ? ': ' + ev.summary : ''}`];
    case 'PermissionDenied': return ['fail', '×', `${who} · ${fmt(ph.denied, { tool: ev.tool })}`];
    case 'Notification':
      if (ev.kind === 'permission_prompt') return ev.time - lastAsk < 15000 ? null : ['ask', '?', `${ph.permission} — ${ev.message || ''}`];
      if (ev.kind === 'idle_prompt') return ['sys', '…', ph.idle];
      return ['sys', '·', ev.message || ev.kind];
    case 'SubagentStart': return ['sub', '入', `${titleOf(ev.agentType)} 입궐 (${ev.agentType})`];
    case 'SubagentStop': return ['sub', '出', `${titleOf(ev.agentType)} 상소: ${ev.report || '맡은 일 마침'}`];
    case 'Stop': return ['stop', '完', ph.stop];
    case 'StopFailure': return ['fail', '×', '일을 마치지 못했사옵니다'];
    case 'SessionEnd': return ['sys', '退', `${ph.sessionEnd}${ev.reason ? ` (${ev.reason})` : ''}`];
    case 'Verdict': {
      const s = config.stamps?.[ev.verdict] || {};
      return ['ask', ev.verdict === 'ok' ? '○' : ev.verdict === 'no' ? '×' : '…', `판정: ${s.full || ev.verdict}`];
    }
    default: return null;
  }
}

function addLog(ev) {
  if (ev.type === 'PostToolUse') {
    const li = ev.toolUseId && byTool.get(ev.toolUseId);
    if (li && !li.querySelector('.ok')) {
      const s = document.createElement('span');
      s.className = 'ok';
      s.textContent = ev.ms != null ? `✓ ${ev.ms < 1000 ? ev.ms + 'ms' : (ev.ms / 1000).toFixed(1) + 's'}` : '✓';
      li.querySelector('.tx').appendChild(s);
    }
    return;
  }
  const line = logLine(ev);
  if (!line) return;
  const [kind, icon, text] = line;
  const li = document.createElement('li');
  li.className = `k-${kind}`;
  const t = document.createElement('time');
  const d = new Date(ev.time || Date.now());
  t.textContent = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  const ic = document.createElement('span');
  ic.className = 'ic';
  ic.textContent = icon;
  const tx = document.createElement('span');
  tx.className = 'tx';
  tx.textContent = text;
  li.append(t, ic, tx);
  if (ev.toolUseId) byTool.set(ev.toolUseId, li);
  const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 30;
  logEl.appendChild(li);
  while (logEl.children.length > 400) logEl.firstChild.remove();
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}

function onEvent(ev, opts = {}) {
  addLog(ev);
  court.handle(ev, opts);
}

// ---------- launch controls ----------
const cwdIn = $('cwd');
const sessSel = $('session');
const statusEl = $('status');
const hint = $('termHint');
function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusEl.textContent = text;
}
let lastCwd = '';
try { lastCwd = localStorage.getItem('eojeon.cwd') || ''; } catch {}
cwdIn.value = DEMO ? '~/projects/my-app' : lastCwd || info.defaultCwd || '';

function fmtTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function loadSessions() {
  const keep = sessSel.value;
  sessSel.innerHTML = '';
  const add = (v, label, parent = sessSel) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    parent.appendChild(o);
    return o;
  };
  add('new', '새 조회 (새 세션)');
  add('continue', '이어서 — 가장 최근 세션 (--continue)');
  add('resume:', '세션 고르기 — Claude Code 목록 (/resume)');
  if (DEMO) return;
  try {
    const r = await fetch(`/api/sessions?cwd=${encodeURIComponent(cwdIn.value.trim())}`).then((x) => x.json());
    if (r.sessions?.length) {
      const g = document.createElement('optgroup');
      g.label = `지난 조회 ${r.sessions.length}개 (최신순)`;
      for (const s of r.sessions) add(`resume:${s.id}`, `${fmtTime(s.mtime)} · ${s.title ? `[${s.title}] ` : ''}${s.first || s.id.slice(0, 8)}`, g);
      sessSel.appendChild(g);
    }
  } catch {}
  if ([...sessSel.options].some((o) => o.value === keep)) sessSel.value = keep;
}
let sessTimer;
cwdIn.addEventListener('input', () => {
  clearTimeout(sessTimer);
  sessTimer = setTimeout(loadSessions, 350);
});
loadSessions();

$('launch').addEventListener('submit', (e) => {
  e.preventDefault();
  if (DEMO) return;
  const v = sessSel.value;
  const cwd = cwdIn.value.trim();
  if (running && !confirm('지금 조회를 끝내고 새로 시작할까요?')) return;
  try { localStorage.setItem('eojeon.cwd', cwd); } catch {}
  let mode = 'new';
  let sessionId = '';
  if (v === 'continue') mode = 'continue';
  else if (v.startsWith('resume:')) {
    mode = 'resume';
    sessionId = v.slice(7);
  }
  term.reset();
  court.reset();
  doFit();
  send({ t: 'start', cwd, mode, sessionId });
  term.focus();
});
$('stopBtn').addEventListener('click', () => {
  if (!DEMO && running && confirm('claude 를 끝낼까요? (진행 중인 일은 멈춥니다)')) send({ t: 'stop' });
});

// ---------- decree input (sent straight into the PTY) ----------
const decreeIn = $('decreeInput');
$('decreeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = decreeIn.value;
  if (!text.trim()) return;
  if (!running && !DEMO) {
    setStatus('error', '먼저 입궐(시작)하세요');
    return;
  }
  // text first, Enter a beat later so Claude Code doesn't treat it as a pasted newline
  sendInput(text);
  setTimeout(() => sendInput('\r'), 60);
  decreeIn.value = '';
  term.focus();
});
decreeIn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.isComposing) e.preventDefault(); // Korean IME: finish composition first
});

// ---------- connection ----------
function connect() {
  ws = new WebSocket(`ws://${location.host}/`);
  ws.onopen = () => doFit();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    switch (msg.t) {
      case 'hello':
        running = msg.running;
        setStatus(running ? 'running' : 'idle', running ? `진행 중 · ${msg.info?.folder || ''}` : '대기');
        hint.classList.toggle('hidden', running);
        logEl.innerHTML = '';
        for (const ev of msg.history || []) onEvent(ev, { replay: true });
        break;
      case 'out':
        hint.classList.add('hidden');
        term.write(msg.d);
        break;
      case 'started':
        running = true;
        hint.classList.add('hidden');
        setStatus('running', `진행 중 · ${msg.info.folder}`);
        break;
      case 'exit':
        running = false;
        setStatus('idle', `끝남 (code ${msg.code})`);
        term.write('\r\n\x1b[2m[claude 가 끝났습니다. 위에서 다시 입궐할 수 있습니다]\x1b[0m\r\n');
        break;
      case 'event':
        onEvent(msg.ev);
        break;
      case 'error':
        setStatus('error', msg.message);
        term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
        break;
      default:
        break;
    }
  };
  ws.onclose = () => {
    setStatus('error', '서버 연결 끊김 — 다시 연결 중');
    setTimeout(connect, 1500);
  };
}

if (DEMO) {
  setStatus('demo', '데모 재생 중 (claude 없음)');
  hint.classList.add('hidden');
  $('startBtn').disabled = true;
  $('stopBtn').disabled = true;
  runDemo({
    term,
    onEvent,
    court,
    speed: Number(params.get('speed')) || 1,
    stopAt: params.has('stop') ? Number(params.get('stop')) : null,
    loop: !params.has('stop'),
  });
} else {
  if (!info.claudeFound) setStatus('error', 'claude 를 찾지 못했습니다 — Claude Code 를 설치하세요');
  connect();
}
