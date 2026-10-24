import { Court, W, H } from './scene.js';
import { runDemo } from './demo.js';
import { titleOf as typeTitle } from './court-types.js';

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
// D2Coding first: its Hangul is exactly 2 cells wide, so Korean text doesn't drift.
// xterm measures the cell size once, so wait for the font before opening the terminal.
await Promise.race([document.fonts.load('13px "D2Coding"', '가A').catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
const term = new window.Terminal({
  fontFamily: '"D2Coding", Menlo, Monaco, Consolas, "Noto Sans Mono CJK KR", monospace',
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

// while another terminal is mirrored (eojeon claude), its size wins so the screen lines up
let mirrorSize = null;
function doFit() {
  try {
    if (mirrorSize) {
      term.resize(mirrorSize.cols, mirrorSize.rows);
      fitFont();
      return;
    }
    fit.fit();
    send({ t: 'resize', cols: term.cols, rows: term.rows });
  } catch {}
}
// the other terminal may be far bigger than this pane: shrink the font until its whole screen fits
const BASE_FONT = 13;
function fitFont(tries = 4) {
  const box = $('term');
  const scr = box.querySelector('.xterm-screen');
  if (!mirrorSize || !scr || !scr.offsetWidth) return;
  const k = Math.min((box.clientWidth - 12) / scr.offsetWidth, (box.clientHeight - 6) / scr.offsetHeight);
  const next = Math.max(4, Math.min(BASE_FONT, Math.floor(term.options.fontSize * k * 10) / 10));
  if (Math.abs(next - term.options.fontSize) < 0.1) return;
  term.options.fontSize = next;
  if (tries > 1) requestAnimationFrame(() => fitFont(tries - 1)); // xterm re-measures cells after a font change
}
function setMirror(size) {
  mirrorSize = size || null;
  if (!mirrorSize && term.options.fontSize !== BASE_FONT) term.options.fontSize = BASE_FONT;
  $('term').classList.toggle('mirror', !!mirrorSize);
  doFit();
}
new ResizeObserver(() => doFit()).observe($('term'));
term.onData((d) => {
  sendInput(d);
  // answered the permission dialog directly in the terminal: Esc = refused
  if (d === '\x1b' && court.petition && !court.petition.closed && !court.petition.ext) {
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
const titleOf = (t) => typeTitle(t, config);
const fmt = (tpl, v) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (v[k] == null ? '' : v[k]));
const byTool = new Map();
let lastAsk = 0;

function logLine(ev) {
  const who = titleOf(ev.agentType);
  switch (ev.type) {
    case 'PtyStart':
      if (ev.mode === 'mirror') return ['sys', '⇄', `다른 터미널의 claude 가 연결됐습니다 · ${ev.folder}`];
      return ['sys', '·', `claude 를 띄웠습니다 · ${ev.folder} (${{ new: '새 조회', continue: '이어서', resume: '세션 이어받기' }[ev.mode] || ev.mode})`];
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
    case 'Agents': return ['sys', '六', ev.text];
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
  // sessions outside the court (eojeon watch) carry their folder name
  tx.textContent = ev.ext ? `⇢ ${ev.folder || '바깥'} · ${text}` : text;
  li.append(t, ic, tx);
  if (ev.toolUseId) byTool.set(ev.toolUseId, li);
  const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 30;
  logEl.appendChild(li);
  while (logEl.children.length > 400) logEl.firstChild.remove();
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}

// ---------- 답변 (prompts and final answers only) ----------
const chatEl = $('chat');
const workingEl = $('working');
function addChat(kind, text, time) {
  if (!text) return;
  $('chatEmpty')?.remove();
  const li = document.createElement('li');
  li.className = kind;
  const who = document.createElement('span');
  who.className = 'who';
  const d = new Date(time || Date.now());
  who.textContent = `${kind === 'q' ? '교지' : '상소'} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  li.append(who, document.createTextNode(text));
  const atBottom = chatEl.scrollTop + chatEl.clientHeight >= chatEl.scrollHeight - 40;
  chatEl.appendChild(li);
  while (chatEl.children.length > 200) chatEl.firstChild.remove();
  if (atBottom || kind === 'q') chatEl.scrollTop = chatEl.scrollHeight;
}
function setWorking(text) {
  workingEl.classList.toggle('hidden', !text);
  workingEl.textContent = text ? `… ${text}` : '';
}
function chatEvent(ev, replay) {
  switch (ev.type) {
    case 'UserPromptSubmit':
      if (!ev.slash) addChat('q', ev.text || ev.prompt, ev.time);
      if (!replay) setWorking('생각하는 중');
      break;
    case 'PreToolUse':
      if (!replay) setWorking(`${titleOf(ev.agentType)} · ${ev.tool}${ev.summary ? ': ' + ev.summary : ''}`);
      break;
    case 'PermissionRequest':
      if (!replay) setWorking(`윤허를 기다리는 중 — ${ev.tool}${ev.summary ? ': ' + ev.summary : ''}`);
      break;
    case 'Stop':
      addChat('a', ev.answer, ev.time);
      if (!replay) setWorking('');
      break;
    case 'StopFailure':
    case 'SessionEnd':
    case 'PtyExit':
      if (!replay) setWorking('');
      break;
    default:
      break;
  }
}

// ---------- side tabs and the terminal toggle ----------
const layoutEl = document.querySelector('.layout');
function showTab(which) {
  $('tabChat').classList.toggle('on', which === 'chat');
  $('tabLog').classList.toggle('on', which === 'log');
  chatEl.classList.toggle('hidden', which !== 'chat');
  logEl.classList.toggle('hidden', which !== 'log');
  try { localStorage.setItem('eojeon.tab', which); } catch {}
}
$('tabChat').addEventListener('click', () => showTab('chat'));
$('tabLog').addEventListener('click', () => showTab('log'));
let savedTab = 'chat';
try { savedTab = localStorage.getItem('eojeon.tab') || 'chat'; } catch {}
showTab(savedTab === 'log' ? 'log' : 'chat');
function showTerm(on) {
  layoutEl.classList.toggle('show-term', on);
  requestAnimationFrame(() => {
    doFit();
    if (on) term.focus();
  });
}
$('termToggle').addEventListener('click', () => showTerm(!layoutEl.classList.contains('show-term')));

function onEvent(ev, opts = {}) {
  addLog(ev);
  chatEvent(ev, !!opts.replay);
  court.handle(ev, opts);
  if (ev.ext && !running && !DEMO) {
    $('termHintMain').innerHTML = `바깥 터미널의 Claude Code 를 보는 중입니다 (<b>${escapeHtml(ev.folder || '')}</b>) — 보기 전용`;
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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

// ---------- permission mode ----------
const pmodeSel = $('pmode');
try { pmodeSel.value = localStorage.getItem('eojeon.pmode') || ''; } catch {}
if (![...pmodeSel.options].some((o) => o.value === pmodeSel.value)) pmodeSel.value = '';
pmodeSel.addEventListener('change', () => {
  try { localStorage.setItem('eojeon.pmode', pmodeSel.value); } catch {}
});

// ---------- 육조 들이기 (offer the default subagents for this folder, once) ----------
const YUKJO = ['ijo', 'hojo', 'yejo', 'byeongjo', 'hyeongjo', 'gongjo'];
const askedKey = (cwd) => `eojeon.yukjo.never:${cwd}`;
async function offerYukjo(cwd) {
  let st;
  try {
    st = await fetch(`/api/agents?cwd=${encodeURIComponent(cwd)}`).then((r) => r.json());
  } catch {
    return;
  }
  if (!st || st.error || st.folderMissing || !st.missing?.length) return;
  try { if (localStorage.getItem(askedKey(st.cwd))) return; } catch {}
  const dlg = $('yukjoDlg');
  $('yukjoWhere').textContent = st.dir;
  $('yukjoMissing').textContent = `${st.missing.length}명`;
  const list = $('yukjoList');
  list.innerHTML = '';
  for (const k of YUKJO) {
    const li = document.createElement('li');
    const d = officials[k] || {};
    li.textContent = `${d.title || k} (${k}) — ${d.role || ''}`;
    if (!st.missing.includes(k)) {
      li.className = 'have';
      li.title = '이미 있음 · 그대로 둡니다';
    }
    list.appendChild(li);
  }
  $('studioChk').checked = false;
  const answer = await new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true });
    dlg.showModal();
  });
  if (answer === 'never') {
    try { localStorage.setItem(askedKey(st.cwd), '1'); } catch {}
    return;
  }
  if (answer !== 'yes') return;
  const pack = $('studioChk').checked ? 'all' : 'yukjo';
  try {
    const r = await fetch('/api/agents/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: st.cwd, pack }),
    }).then((x) => x.json());
    if (r.error) throw new Error(r.error);
    const text = `육조를 들였사옵니다 · 새로 ${r.copied.length}명${r.skipped.length ? ` · 이미 있어 건너뜀 ${r.skipped.length}명(${r.skipped.join(', ')})` : ''}`;
    addLog({ type: 'Agents', time: Date.now(), text });
    court.showToast(text, 4200);
  } catch (err) {
    setStatus('error', `육조 들이기 실패: ${err.message}`);
  }
}

$('launch').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (DEMO) return;
  const v = sessSel.value;
  const cwd = cwdIn.value.trim();
  if (running && !confirm('지금 조회를 끝내고 새로 시작할까요?')) return;
  try { localStorage.setItem('eojeon.cwd', cwd); } catch {}
  await offerYukjo(cwd);
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
  send({ t: 'start', cwd, mode, sessionId, permissionMode: pmodeSel.value });
  showTerm(true);
});
$('stopBtn').addEventListener('click', () => {
  if (!DEMO && running && confirm('claude 를 끝낼까요? (진행 중인 일은 멈춥니다)')) send({ t: 'stop' });
});

// ---------- the one input: a decree, typed straight into claude ----------
const chatIn = $('chatInput');
function submitDecree() {
  const text = chatIn.value;
  if (!text.trim()) return;
  if (!running && !DEMO) {
    setStatus('error', '먼저 입궐(시작)하거나 내 터미널에서 eojeon claude 로 켜세요');
    return;
  }
  // text first, Enter a beat later so Claude Code doesn't treat it as a pasted newline
  sendInput(text.replace(/\s*\n\s*/g, ' '));
  setTimeout(() => sendInput('\r'), 80);
  chatIn.value = '';
}
$('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitDecree();
});
chatIn.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  if (e.isComposing) return; // Korean IME: finish composition first
  submitDecree();
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
        setMirror(msg.size);
        setStatus(running ? 'running' : 'idle', running ? `${msg.size ? '다른 터미널 연결' : '진행 중'} · ${msg.info?.folder || ''}` : '대기');
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
        if (msg.size) {
          term.reset();
          court.reset();
        }
        setMirror(msg.size);
        setStatus('running', `${msg.size ? '다른 터미널 연결' : '진행 중'} · ${msg.info.folder}`);
        break;
      case 'size':
        setMirror({ cols: msg.cols, rows: msg.rows });
        break;
      case 'exit':
        running = false;
        setMirror(null);
        setStatus('idle', msg.mirror ? '다른 터미널 연결 끝남' : `끝남 (code ${msg.code})`);
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
  if (info.remote) $('footLocal').textContent = '다른 기기 접속 켜짐 (--host) · 접속 키가 있는 기기만 들어올 수 있습니다.';
  connect();
}
