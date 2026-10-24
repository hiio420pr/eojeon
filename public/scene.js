// Pixel court scene: canvas for the drawing, a DOM overlay (same logical
// coordinates) for text, bubbles, the petition panel and stamps.
// Everything here is hand-drawn rectangles — no traced photos, no real seals.

import { lookupOfficial } from './court-types.js';

export const W = 400;
export const H = 224;

const FPS = 8; // sprite frame rate (concept: 8fps, walk 4 frames, brush 2 frames)
const WALK_SPEED = 64; // logical px per second
const MAX_BUBBLES = 3; // more than this at once → only the newest show; the rest are in the 사관 일지
// petition panel sits top-right over the back wall, clear of every desk and the throne
export const PETITION_BOX = { x: 238, y: 4, w: 158 };

const EMBLEMS = {
  scrolls: ['1111', '1001', '1111', '1001'],
  grid: ['1111', '1010', '1111', '1010'],
  abacus: ['1010', '1111', '0101', '1111'],
  flag: ['1110', '1100', '1000', '1000'],
  brush: ['0001', '0010', '0100', '1100'],
  seal: ['1111', '1001', '1001', '1111'],
  scale: ['1001', '1111', '0110', '0110'],
  hoof: ['0110', '1001', '1001', '1001'],
  square: ['1000', '1000', '1000', '1111'],
  beam: ['1111', '0110', '0110', '0110'],
  drum: ['0110', '1111', '1111', '0110'],
  album: ['1110', '1010', '1110', '0000'],
  plain: ['0000', '0110', '0110', '0000'],
  steps: ['0001', '0011', '0111', '1111'],
  shield: ['1111', '1111', '1111', '0110'],
  lens: ['0110', '1001', '0110', '0001'],
  hammer: ['1111', '1111', '0100', '0100'],
};

// seat index -> position. Row-major, nearest the throne first; inner column first.
const SEATS = {
  east: [[124, 104], [62, 104], [124, 140], [62, 140], [124, 176], [62, 176]],
  west: [[276, 104], [338, 104], [276, 140], [338, 140], [276, 176], [338, 176]],
};
const GUEST_SPOTS = [[168, 206], [232, 206], [146, 214], [254, 214], [190, 218], [210, 218], [102, 214], [298, 214]];
const DOOR = [200, H + 24];
const THRONE_FRONT = [200, 92];
const HISTORIAN = [84, 76];

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function fmt(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function elapsedText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}초째`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분째`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분째`;
}

class Official {
  constructor(court, { key, def, kind, id }) {
    this.court = court;
    this.key = key; // agent type ('main' for Claude itself)
    this.id = id || key;
    this.kind = kind; // 'main' | 'seat' | 'guest' | 'historian'
    this.title = def.title;
    this.role = def.role || '';
    this.robe = def.robe || 'nok';
    this.emblem = def.emblem || 'plain';
    this.home = [0, 0];
    this.x = DOOR[0];
    this.y = DOOR[1];
    this.path = [];
    this.onArrive = null;
    this.state = 'away'; // away | walking | seated | working | standing
    this.workUntil = 0;
    this.workStart = 0;
    this.carry = false;
    this.blotUntil = 0;
    this.visible = false;
    this.blinkSeed = Math.random() * 4000;
    this.tag = el('div', `tag robe-${this.robe}`, court.overlay, this.title);
    this.bubble = el('div', 'bubble', court.overlay);
    this.bubbleMain = el('div', 'b-main', this.bubble);
    this.bubbleSub = el('div', 'b-sub', this.bubble);
    this.bubbleUntil = 0;
    this.bubbleSticky = false;
    this.tag.title = this.role;
  }

  place(x, y) {
    this.x = x;
    this.y = y;
  }

  walk(points, onArrive) {
    this.path = points.map((p) => [...p]);
    this.onArrive = onArrive || null;
    this.state = 'walking';
    this.visible = true;
    if (this.court.reduced) {
      const last = this.path[this.path.length - 1];
      this.x = last[0];
      this.y = last[1];
      this.path = [];
      this.arrive();
    }
  }

  arrive() {
    const cb = this.onArrive;
    this.onArrive = null;
    this.state = this.atHome() && this.kind !== 'guest' ? 'seated' : 'standing';
    if (cb) cb();
  }

  atHome() {
    return Math.abs(this.x - this.home[0]) < 1 && Math.abs(this.y - this.home[1]) < 1;
  }

  say(main, sub = '', ms = 3200, sticky = false) {
    this.bubbleMain.textContent = main;
    this.bubbleSub.textContent = sub;
    this.bubbleSub.style.display = sub ? '' : 'none';
    this.bubbleUntil = performance.now() + ms;
    this.bubbleSticky = sticky;
    this.bubbleAt = performance.now();
  }

  hush() {
    this.bubbleUntil = 0;
    this.bubbleSticky = false;
  }

  work(text) {
    this.workStart = performance.now();
    this.workUntil = Infinity;
    this.workText = text;
    if (this.state === 'seated' || this.state === 'standing') this.state = 'working';
    this.say(text, '', 60_000, true);
  }

  doneWork(ok = true, failText = '') {
    this.workUntil = performance.now() + 700;
    this.bubbleSticky = false;
    if (!ok) {
      this.blotUntil = performance.now() + 4000;
      this.say(failText, '두루마리에 먹물이 번졌사옵니다', 4000);
    } else {
      this.bubbleUntil = performance.now() + 1400;
    }
  }

  step(dt, now) {
    if (this.path.length) {
      const [tx, ty] = this.path[0];
      const dx = tx - this.x;
      const dy = ty - this.y;
      const d = Math.hypot(dx, dy);
      const v = WALK_SPEED * dt;
      if (d <= v) {
        this.x = tx;
        this.y = ty;
        this.path.shift();
        if (!this.path.length) this.arrive();
      } else {
        this.x += (dx / d) * v;
        this.y += (dy / d) * v;
      }
    }
    if (this.state === 'working' && now > this.workUntil) this.state = this.atHome() && this.kind !== 'guest' ? 'seated' : 'standing';
  }

  updateDom(now) {
    const show = this.visible;
    const bx = Math.round(this.x);
    const by = Math.round(this.y);
    this.tag.style.display = show && this.state !== 'walking' ? '' : 'none';
    this.tag.style.transform = `translate(${bx}px, ${by + 2}px) translateX(-50%)`;
    // position is decided by Court.layoutBubbles (overlap avoidance, max 3 at once)
    this.bubbleOn = show && (this.bubbleSticky || now < this.bubbleUntil);
    this.anchor = [bx, by - 34];
    if (!this.bubbleOn) this.bubble.classList.remove('on');
    if (this.bubbleOn) {
      if (this.state === 'working' && this.workUntil === Infinity) {
        this.bubbleSub.style.display = '';
        this.bubbleSub.textContent = `${this.court.ph.workingSuffix || '중이옵니다'} · ${elapsedText(now - this.workStart)}`;
      }
      this.bubble.classList.toggle('blot', now < this.blotUntil);
    }
  }

  draw(ctx, now, px) {
    if (!this.visible) return;
    const seated = this.state === 'seated' || (this.state === 'working' && this.atHome() && this.kind !== 'guest');
    const frame = Math.floor((now / 1000) * FPS);
    const walking = this.state === 'walking';
    const working = this.state === 'working';
    const wf = walking ? frame % 4 : 0;
    const bob = walking && (wf === 1 || wf === 3) ? -1 : 0;
    const ox = Math.round(this.x) - 16;
    const oy = Math.round(this.y) - 31 + bob + (seated ? 3 : 0);
    const P = this.court.pix;
    const robe = P[this.robe] || P.nok;
    const robeD = shade(robe, 0.72);
    const O = P.outline;
    const r = (x, y, w, h, c) => px(ox + x, oy + y, w, h, c);

    // shadow
    px(Math.round(this.x) - 9, Math.round(this.y) + (seated ? 2 : 0), 18, 2, 'rgba(0,0,0,0.35)');

    // samo (official's hat): crown + wings
    r(12, 0, 8, 1, O);
    r(11, 1, 10, 6, O);
    r(12, 1, 8, 5, P.heuk);
    r(13, 1, 6, 1, shade(P.heuk, 1.5));
    r(5, 4, 22, 3, O);
    r(6, 5, 5, 1, P.heuk);
    r(21, 5, 5, 1, P.heuk);
    // face
    r(11, 7, 10, 7, O);
    r(12, 7, 8, 6, P.skin);
    r(12, 12, 8, 1, P.skinShade);
    const blink = (now + this.blinkSeed) % 4000 < 130;
    if (blink) {
      r(14, 10, 1, 1, P.skinShade);
      r(17, 10, 1, 1, P.skinShade);
    } else {
      r(14, 9, 1, 2, O);
      r(17, 9, 1, 2, O);
    }
    // robe (dallyeong)
    const rows = [
      [10, 12], [9, 14], [9, 14], [8, 16], [8, 16], [8, 16], [7, 18], [7, 18],
      [7, 18], [7, 18], [6, 20], [6, 20], [6, 20], [6, 20], [6, 20], [6, 20],
    ];
    rows.forEach(([x0, w], i) => {
      r(x0 - 1, 14 + i, w + 2, 1, O);
      r(x0, 14 + i, w, 1, robe);
    });
    r(5, 29, 22, 1, O);
    // round collar
    r(13, 14, 6, 1, P.paper);
    r(14, 15, 4, 1, robeD);
    // sleeves (darker), hands
    const brushUp = working && frame % 2 === 0;
    // walk cycle (4 frames): arms swing opposite to the stepping foot
    const swing = walking ? [0, -1, 0, 1][wf] : 0;
    r(6, 18 + swing, 3, 8, robeD);
    r(6, 26 + swing, 3, 2, P.skin);
    if (working) {
      // right arm works the brush over the desk / scroll
      r(21, 18, 4, 4, robeD);
      r(22, brushUp ? 20 : 22, 3, 2, P.skin);
      r(24, brushUp ? 16 : 18, 1, 5, O); // brush
      r(24, brushUp ? 21 : 23, 1, 1, P.heuk);
    } else {
      r(23, 18 - swing, 3, 8, robeD);
      r(23, 26 - swing, 3, 2, P.skin);
    }
    // hyungbae (chest square): job motif, border 2 lines for hong(당상관), 1 for others
    const border = (this.court.cfg.robes?.[this.robe]?.border) || 1;
    r(12, 16, 8, 8, P.hwang);
    if (border >= 2) {
      r(13, 17, 6, 6, P.heuk);
      r(13, 17, 6, 1, P.hwang);
      r(13, 22, 6, 1, P.hwang);
      r(13, 17, 1, 6, P.hwang);
      r(18, 17, 1, 6, P.hwang);
      r(14, 18, 4, 4, P.heuk);
    } else {
      r(13, 17, 6, 6, P.heuk);
    }
    const em = EMBLEMS[this.emblem] || EMBLEMS.plain;
    em.forEach((row, yy) => [...row].forEach((b, xx) => b === '1' && r(14 + xx, 18 + yy, 1, 1, P.paper)));
    // belt (seodae)
    r(8, 25, 16, 1, P.hwang);
    // feet
    const lf = walking && wf === 1 ? -1 : 0;
    const rf = walking && wf === 3 ? -1 : 0;
    r(10, 30 + lf, 5, 2, O);
    r(17, 30 + rf, 5, 2, O);
    // carried scroll
    if (this.carry) {
      r(4, 23, 3, 7, O);
      r(4, 24, 3, 5, P.paper);
      r(3, 23, 5, 1, P.hwang);
      r(3, 29, 5, 1, P.hwang);
    }
    // desk in front when seated
    if (seated) this.court.drawDesk(Math.round(this.home[0]), Math.round(this.home[1]), working && frame % 2 === 0);
  }

  remove() {
    this.tag.remove();
    this.bubble.remove();
  }
}

export class Court {
  constructor({ canvas, overlay, config, onPetitionAction }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.overlay = overlay;
    this.cfg = config;
    this.pix = config.pixel;
    this.ph = config.phrases || {};
    this.onPetitionAction = onPetitionAction;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    canvas.width = W;
    canvas.height = H;
    this.officials = new Map(); // id -> Official
    this.byAgent = new Map(); // agent_id -> official id
    this.guestUsed = new Set();
    this.seatUsed = new Set(); // 'east:0' ...
    this.fixedSeats = new Map(); // 'east:1' -> config key that owns that desk
    for (const [k, d] of Object.entries(config.officials || {})) {
      if (!k.startsWith('_') && d && d.side && Number.isInteger(d.seat)) this.fixedSeats.set(`${d.side}:${d.seat}`, k);
    }
    this.walkQueue = [];
    this.petition = null;
    this.stats = { petitions: 0, ok: 0, no: 0, hold: 0 };
    this.kingAnim = null;
    this.dusk = 0;
    this.duskTarget = 0;
    this.historianWriteUntil = 0;
    this.bg = this.drawBackground();
    this.buildOverlay();
    this.spawnMain();
    this.last = performance.now();
    this.paused = false;
    const loop = (t) => {
      this.frame(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---------- static background ----------
  drawBackground() {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const P = this.pix;
    const pal = this.cfg.palette;
    const R = (x, y, w, h, col) => {
      g.fillStyle = col;
      g.fillRect(x, y, w, h);
    };
    // night court base
    R(0, 0, W, H, pal.paper);
    // back wall of the hall
    R(0, 0, W, 78, '#1A1D24');
    // lattice doors on the back wall
    for (let x = 8; x < W; x += 24) {
      if (x > 136 && x < 256) continue;
      R(x, 16, 16, 50, '#20242C');
      for (let yy = 18; yy < 64; yy += 6) R(x + 1, yy, 14, 1, '#2A2F38');
      for (let xx = x + 3; xx < x + 16; xx += 5) R(xx, 17, 1, 48, '#2A2F38');
    }
    // dancheong band: one line of nok / cheong / hong (concept 4-3)
    const band = [P.nok, P.cheong, P.hong];
    for (let x = 0; x < W; x += 6) R(x, 4, 6, 4, band[(x / 6) % 3]);
    R(0, 2, W, 2, P.heuk);
    R(0, 8, W, 1, P.outline);
    // pillars
    for (const x of [40, 112, 280, 352]) {
      R(x - 1, 9, 10, 72, P.outline);
      R(x, 9, 8, 72, P.hong);
      R(x + 1, 9, 2, 72, shade(P.hong, 1.25));
      R(x - 2, 78, 12, 4, P.stoneShade);
    }

    // ---- Irworobongdo (sun, moon, five peaks), redrawn as plain shapes ----
    const sx = 144;
    const sy = 12;
    const sw = 112;
    const sh = 50;
    R(sx - 2, sy - 2, sw + 4, sh + 4, P.outline);
    R(sx - 1, sy - 1, sw + 2, sh + 2, P.hwang);
    R(sx, sy, sw, sh, '#1C3F5C'); // night-blue sky
    // panel seams of the folding screen
    for (let i = 1; i < 5; i++) R(sx + (sw / 5) * i, sy, 1, sh, 'rgba(0,0,0,0.25)');
    // moon (left, white) and sun (right, red)
    const disc = (cx, cy, rad, col) => {
      for (let yy = -rad; yy <= rad; yy++) {
        const w = Math.round(Math.sqrt(rad * rad - yy * yy));
        R(cx - w, cy + yy, w * 2 + 1, 1, col);
      }
    };
    disc(sx + 20, sy + 10, 5, P.paper);
    disc(sx + sw - 20, sy + 10, 5, P.inju);
    // five peaks
    const peak = (cx, base, hgt, half, col) => {
      for (let yy = 0; yy < hgt; yy++) {
        const w = Math.round((half * yy) / hgt);
        R(cx - w, base - hgt + yy, w * 2 + 1, 1, col);
      }
    };
    const pk = P.nok;
    const pkL = shade(P.nok, 1.35);
    peak(sx + 56, sy + 40, 30, 16, pk);
    peak(sx + 56, sy + 40, 30, 6, pkL);
    peak(sx + 30, sy + 40, 22, 14, pk);
    peak(sx + 82, sy + 40, 22, 14, pk);
    peak(sx + 12, sy + 42, 16, 12, shade(pk, 0.85));
    peak(sx + 100, sy + 42, 16, 12, shade(pk, 0.85));
    // waterfalls
    R(sx + 43, sy + 26, 1, 14, P.paper);
    R(sx + 69, sy + 26, 1, 14, P.paper);
    // water: two wave lines
    R(sx, sy + 40, sw, 10, P.cheong);
    for (let x = sx; x < sx + sw; x += 8) {
      R(x + 1, sy + 42, 4, 1, P.paper);
      R(x + 5, sy + 46, 4, 1, P.paper);
    }
    // two pines
    for (const tx of [sx + 4, sx + sw - 8]) {
      R(tx + 1, sy + 22, 2, 20, P.hong);
      R(tx - 2, sy + 18, 8, 3, P.nok);
      R(tx - 1, sy + 14, 6, 3, P.nok);
      R(tx - 3, sy + 24, 9, 2, P.nok);
    }

    // canopy (datjip) outline above the throne
    R(sx - 8, 9, sw + 16, 3, P.outline);
    R(sx - 6, 10, sw + 12, 1, P.hwang);

    // throne: three steps + chair (no dragon carving)
    R(176, 50, 48, 14, P.outline);
    R(177, 51, 46, 12, P.hong);
    R(179, 52, 42, 2, P.hwang);
    R(180, 44, 40, 8, P.outline);
    R(181, 45, 38, 6, P.hong);
    R(181, 45, 38, 1, P.hwang);
    R(176, 62, 4, 6, P.hwang);
    R(220, 62, 4, 6, P.hwang);
    const steps = [[168, 66, 64], [160, 70, 80], [152, 74, 96]];
    for (const [x, y, w] of steps) {
      R(x, y, w, 4, P.stoneShade);
      R(x, y, w, 1, P.stone);
    }

    // courtyard: night-toned stone slabs (bakseok)
    for (let y = 78; y < H; y += 8) {
      for (let x = ((y / 8) % 2) * 6; x < W; x += 12) {
        const v = ((x * 7 + y * 13) % 5) / 100;
        R(x, y, 11, 7, shade('#2A2C31', 0.92 + v));
      }
    }
    R(0, 78, W, 2, P.outline);
    // royal road (eodo) in the middle
    R(182, 80, 36, H - 80, '#3A3933');
    for (let y = 80; y < H; y += 10) R(183, y, 34, 1, '#46443D');
    R(181, 80, 1, H - 80, P.outline);
    R(218, 80, 1, H - 80, P.outline);

    // rank stones: 6 per side, labelled in the overlay with the office's first letter
    for (const side of ['east', 'west']) {
      for (const [x, y] of SEATS[side]) {
        const stx = side === 'east' ? x + 22 : x - 30;
        R(stx, y - 14, 8, 14, P.outline);
        R(stx + 1, y - 13, 6, 13, P.stone);
        R(stx + 1, y - 13, 6, 1, '#D8D2C6');
        R(stx + 1, y - 1, 6, 1, P.stoneShade);
      }
    }
    // gate at the bottom
    R(176, H - 4, 48, 4, P.hong);
    R(176, H - 5, 48, 1, P.hwang);
    return c;
  }

  drawDesk(x, y, wet) {
    const P = this.pix;
    const g = this.ctx;
    const R = (a, b, w, h, col) => {
      g.fillStyle = col;
      g.fillRect(a, b, w, h);
    };
    R(x - 11, y - 9, 22, 8, P.outline);
    R(x - 10, y - 8, 20, 6, '#6E4B2A');
    R(x - 10, y - 8, 20, 1, '#8A5F36');
    R(x - 9, y - 2, 2, 3, P.outline);
    R(x + 7, y - 2, 2, 3, P.outline);
    R(x - 6, y - 9, 10, 3, P.paper); // paper on the desk
    if (wet) R(x - 3, y - 8, 3, 1, P.heuk);
    R(x + 5, y - 9, 3, 2, P.heuk); // inkstone
  }

  buildOverlay() {
    const o = this.overlay;
    o.style.width = W + 'px';
    o.style.height = H + 'px';
    // stone labels: fixed desks show their owner's letter; free desks get one when someone sits
    const all = this.cfg.officials || {};
    this.stoneLabels = new Map();
    for (const side of ['east', 'west']) {
      SEATS[side].forEach(([x, y], i) => {
        const k = `${side}:${i}`;
        const stx = side === 'west' ? x - 30 : x + 22;
        const s = el('div', 'stone-label', o, '');
        s.style.transform = `translate(${stx + 4}px, ${y - 12}px) translateX(-50%)`;
        const owner = all[this.fixedSeats.get(k)];
        s.dataset.text = owner ? owner.short || owner.title[0] : '';
        s.dataset.title = owner ? `${owner.title} — ${owner.role || ''}` : '';
        s.textContent = s.dataset.text;
        s.title = s.dataset.title;
        this.stoneLabels.set(k, s);
      });
    }
    this.more = el('div', 'bubble-more', o);
    // decree scroll
    this.decree = el('div', 'decree', o);
    el('div', 'd-head', this.decree, '교지');
    this.decreeText = el('div', 'd-text', this.decree);
    this.decreeFoot = el('div', 'd-foot', this.decree, this.ph.decree || '교지를 반포하였사옵니다');
    // petition panel
    this.pet = el('div', 'petition', o);
    this.petHead = el('div', 'p-head', this.pet);
    this.petAsk = el('div', 'p-ask', this.pet, this.ph.permission || '윤허를 청하옵니다');
    this.petWait = el('div', 'p-wait', this.pet);
    const btns = el('div', 'p-btns', this.pet);
    for (const k of ['ok', 'no', 'hold']) {
      const st = (this.cfg.stamps || {})[k] || { label: k };
      const b = el('button', `p-btn p-${k}`, btns);
      el('span', 'mk', b, st.mark || '');
      el('span', 'lb', b, st.label);
      b.addEventListener('click', () => this.petitionAction(k));
    }
    el('div', 'p-hint', this.pet, this.ph.permissionHint || '');
    this.pet.title = this.ph.permissionHint || '';
    // stamp + plaque
    this.stamp = el('div', 'stamp', o);
    this.stampMark = el('div', 'st-mark', this.stamp);
    this.stampLabel = el('div', 'st-label', this.stamp);
    this.stampFull = el('div', 'stamp-full', o);
    this.plaque = el('div', 'plaque', o);
    this.toast = el('div', 'toast', o);
  }

  spawnMain() {
    const def = this.cfg.officials.main;
    const m = new Official(this, { key: 'main', def, kind: 'main', id: 'main' });
    m.home = [...SEATS[def.side][def.seat]];
    m.seat = `${def.side}:${def.seat}`;
    this.seatUsed.add(m.seat);
    m.place(...m.home);
    m.visible = true;
    m.state = 'seated';
    this.officials.set('main', m);
    this.main = m;
    const hdef = this.cfg.historian || { title: '사관', robe: 'nok' };
    const h = new Official(this, { key: 'historian', def: { ...hdef, emblem: 'brush' }, kind: 'historian', id: 'historian' });
    h.home = [...HISTORIAN];
    h.place(...HISTORIAN);
    h.visible = true;
    h.state = 'standing';
    h.tag.classList.add('small');
    this.officials.set('historian', h);
    this.historian = h;
  }

  // ---------- helpers ----------
  officialFor(agentType, agentId) {
    if (!agentId && !agentType) return this.main;
    if (agentId && this.byAgent.has(agentId)) return this.officials.get(this.byAgent.get(agentId)) || this.main;
    return null;
  }

  // A desk for this official: its own fixed desk, else a free unowned desk (own side first),
  // else a fixed desk whose owner is away. null → stands in the courtyard.
  takeSeat(def) {
    const sides = def.side === 'west' ? ['west', 'east'] : ['east', 'west'];
    const free = (k) => !this.seatUsed.has(k);
    let k = null;
    if (def.side && Number.isInteger(def.seat) && free(`${def.side}:${def.seat}`)) k = `${def.side}:${def.seat}`;
    for (const pass of [0, 1]) {
      for (const side of sides) {
        for (let i = 0; !k && i < SEATS[side].length; i++) {
          const c = `${side}:${i}`;
          if (free(c) && (pass === 1 || !this.fixedSeats.has(c))) k = c;
        }
      }
    }
    if (!k) return null;
    this.seatUsed.add(k);
    const [side, i] = k.split(':');
    const label = this.stoneLabels.get(k);
    if (label) {
      label.textContent = def.short || def.title[0];
      label.title = `${def.title} — ${def.role || ''}`;
    }
    return { k, pos: SEATS[side][Number(i)] };
  }

  releaseSeat(k) {
    if (!k) return;
    this.seatUsed.delete(k);
    const label = this.stoneLabels.get(k);
    if (label) {
      label.textContent = label.dataset.text;
      label.title = label.dataset.title;
    }
  }

  enterOfficial(agentType, agentId) {
    const found = lookupOfficial(agentType, this.cfg);
    let def = found.def;
    const dup = found.kind === 'seat' && this.officials.has(found.key);
    const seat = found.kind === 'seat' && !dup ? this.takeSeat(def) : null;
    const kind = seat ? 'seat' : 'guest';
    const id = seat ? found.key : `guest:${agentId || Math.random()}`;
    if (dup) def = { ...def, title: `${def.title}(둘째)` }; // parallel agent of the same type
    const o = new Official(this, { key: found.key, def, kind, id });
    if (seat) {
      o.home = [...seat.pos];
      o.seat = seat.k;
    } else {
      const i = GUEST_SPOTS.findIndex((_, k) => !this.guestUsed.has(k));
      const k = i < 0 ? Math.floor(Math.random() * GUEST_SPOTS.length) : i;
      this.guestUsed.add(k);
      o.guestSpot = k;
      o.home = [...GUEST_SPOTS[k]];
    }
    o.place(...DOOR);
    this.officials.set(id, o);
    if (agentId) this.byAgent.set(agentId, id);
    const route = kind === 'seat' ? [[200, DOOR[1] - 30], [200, o.home[1] + 6], [o.home[0], o.home[1] + 6], o.home] : [[200, DOOR[1] - 30], o.home];
    this.queueWalk(o, route, () => {
      // it may have started a tool while still walking in: keep showing that work, not the greeting
      if (o.workUntil === Infinity) {
        o.state = 'working';
        o.say(o.workText, '', 60_000, true);
      } else o.say(fmt(this.ph.enter, { title: o.title }), o.role, 2600);
    });
    return o;
  }

  leaveOfficial(o, report) {
    if (!o || o === this.main) return;
    const mainSpot = [this.main.home[0] + 18, this.main.home[1] + 8];
    o.carry = true;
    o.hush();
    const toMain = [[o.x, o.home[1] + 6], [200, o.home[1] + 6], [200, mainSpot[1]], mainSpot];
    this.queueWalk(o, toMain, () => {
      o.say(report ? fmt(this.ph.report, { report }) : this.ph.reportEmpty, '', 2600);
      if (!this.main.bubbleSticky) this.main.say('받았소', '', 1400); // never hide a petition or work bubble
      setTimeout(() => {
        o.carry = false;
        this.queueWalk(o, [[200, mainSpot[1]], [200, DOOR[1] - 20], DOOR], () => {
          o.visible = false;
          o.remove();
          this.officials.delete(o.id);
          if (o.guestSpot != null) this.guestUsed.delete(o.guestSpot);
          this.releaseSeat(o.seat);
        });
      }, this.reduced ? 1200 : 2200);
    });
  }

  // concept: one walker at a time so each move reads clearly
  queueWalk(o, route, cb) {
    this.walkQueue.push({ o, route, cb });
    this.pumpWalks();
  }

  pumpWalks() {
    if (this.walking) return;
    const next = this.walkQueue.shift();
    if (!next) return;
    this.walking = next.o;
    next.o.walk(next.route, () => {
      this.walking = null;
      try {
        next.cb && next.cb();
      } finally {
        this.pumpWalks();
      }
    });
  }

  showDecree(text, slash) {
    this.decreeText.textContent = text || '…';
    this.decreeFoot.textContent = slash ? fmt(this.ph.decreeSlash, { prompt: text }) : this.ph.decree;
    this.decree.classList.remove('on');
    void this.decree.offsetWidth;
    this.decree.classList.add('on');
    clearTimeout(this.decreeTimer);
    this.decreeTimer = setTimeout(() => this.decree.classList.remove('on'), slash ? 2600 : 4200);
    this.historianWrite();
    this.kingDo('decree', 2.2);
  }

  historianWrite() {
    this.historian.workStart = performance.now();
    this.historian.workUntil = performance.now() + 1600;
    this.historian.state = 'working';
  }

  showToast(text, ms = 2400) {
    this.toast.textContent = text;
    this.toast.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.remove('on'), ms);
  }

  showPlaque(text, ms = 3200) {
    this.plaque.textContent = text;
    this.plaque.classList.remove('on');
    void this.plaque.offsetWidth;
    this.plaque.classList.add('on');
    clearTimeout(this.plaqueTimer);
    this.plaqueTimer = setTimeout(() => this.plaque.classList.remove('on'), ms);
  }

  // ---------- petition (permission request) ----------
  openPetition({ tool, summary, message, actor }) {
    const who = actor || this.main;
    const head = tool ? fmt(this.ph.petition, { tool, summary: summary || '' }) : `아뢰옵니다 — ${message || '권한이 필요합니다'}`;
    if (this.petition && !this.petition.closed) {
      // a Notification right after PermissionRequest: keep the richer one
      if (!tool) return;
    } else {
      this.stats.petitions++;
    }
    this.petition = { tool, summary, since: performance.now(), actor: who, closed: false };
    this.petHead.textContent = head;
    this.pet.classList.add('on');
    this.pet.classList.remove('min');
    who.carry = true;
    who.workUntil = performance.now(); // waiting, not working
    who.say(this.ph.permission || '윤허를 청하옵니다', '', 60_000, true);
  }

  petitionAction(kind) {
    if (!this.petition || this.petition.closed) return;
    if (kind === 'hold') {
      this.pet.classList.add('min');
      this.stampVerdict('hold');
      this.onPetitionAction && this.onPetitionAction('hold');
      return;
    }
    this.onPetitionAction && this.onPetitionAction(kind);
    this.closePetition(kind);
  }

  closePetition(verdict) {
    const p = this.petition;
    if (!p || p.closed) return;
    p.closed = true;
    this.pet.classList.remove('on', 'min');
    p.actor.carry = false;
    p.actor.hush();
    if (verdict) this.stampVerdict(verdict);
  }

  stampVerdict(kind) {
    const st = (this.cfg.stamps || {})[kind] || { label: kind, mark: '' };
    if (kind in this.stats) this.stats[kind]++;
    this.stamp.className = `stamp shape-${st.shape || 'circle'} k-${kind}`;
    this.stampMark.textContent = st.mark || '';
    this.stampLabel.textContent = st.label;
    this.stampFull.textContent = st.full || st.label;
    this.stampFull.className = `stamp-full k-${kind}`;
    void this.stamp.offsetWidth;
    if (kind === 'ok') this.kingDo('nod', 1.1);
    else if (kind === 'no') this.kingDo('wave', 1.2);
    const delay = this.reduced ? 0 : 160;
    setTimeout(() => {
      this.stamp.classList.add('on');
      this.stampFull.classList.add('on');
    }, delay);
    clearTimeout(this.stampTimer);
    this.stampTimer = setTimeout(() => {
      this.stamp.classList.remove('on');
      this.stampFull.classList.remove('on');
    }, 2600);
  }

  // ---------- event handling ----------
  handle(ev, { replay = false } = {}) {
    if (replay) return; // history is shown in the log only; the scene starts fresh
    const ph = this.ph;
    const actor = ev.agentId ? this.officialFor(ev.agentType, ev.agentId) || this.enterOfficial(ev.agentType, ev.agentId) : this.main;
    switch (ev.type) {
      case 'SessionStart': {
        this.duskTarget = 0;
        const resumed = ev.source === 'resume' || ev.source === 'fork';
        if (ev.source === 'clear' || ev.source === 'compact') this.showToast(ev.source === 'clear' ? '조정을 새로 엽니다 (/clear)' : '기록을 줄였사옵니다 (compact)');
        else this.showToast(fmt(resumed ? ph.sessionResume : ph.sessionStart, { folder: ev.folder || '' }));
        this.main.visible = true;
        break;
      }
      case 'UserPromptSubmit':
        if (this.petition && !this.petition.closed) this.closePetition(null);
        this.showDecree(ev.prompt, ev.slash);
        this.main.say('교지를 받드옵니다', '', 1800);
        break;
      case 'PreToolUse': {
        if (ev.spawnType) {
          actor.say(`${ev.tool}: ${ev.spawnType} 부르는 중`, '', 2000);
          break;
        }
        actor.work(fmt(ph.working, { tool: ev.tool, summary: ev.summary || '' }).replace(/:\s*$/, ''));
        break;
      }
      case 'PostToolUse':
        if (this.petition && !this.petition.closed && this.petition.tool === ev.tool) this.closePetition('ok');
        if (!ev.spawnType) actor.doneWork(true);
        break;
      case 'PostToolUseFailure':
        if (this.petition && !this.petition.closed) this.closePetition(null);
        actor.doneWork(false, fmt(ph.failed, { tool: ev.tool }));
        break;
      case 'PermissionRequest':
        this.openPetition({ tool: ev.tool, summary: ev.summary, actor });
        break;
      case 'PermissionDenied':
        if (this.petition && !this.petition.closed) this.closePetition('no');
        actor.doneWork(false, fmt(ph.denied, { tool: ev.tool }));
        break;
      case 'Notification':
        if (ev.kind === 'permission_prompt') {
          if (!this.petition || this.petition.closed) this.openPetition({ message: ev.message, actor });
        } else if (ev.kind === 'idle_prompt') {
          this.main.say(ph.idle || '분부를 기다리옵니다', '', 120_000);
        } else if (ev.message) {
          this.showToast(ev.message);
        }
        break;
      case 'SubagentStart':
        if (!this.byAgent.has(ev.agentId)) this.enterOfficial(ev.agentType, ev.agentId);
        break;
      case 'SubagentStop': {
        const o = this.officialFor(ev.agentType, ev.agentId);
        if (o && o !== this.main) {
          this.byAgent.delete(ev.agentId);
          this.leaveOfficial(o, ev.report);
        }
        break;
      }
      case 'Stop':
      case 'StopFailure': {
        if (this.petition && !this.petition.closed) this.closePetition(null);
        const m = this.main;
        const fail = ev.type === 'StopFailure';
        m.carry = true;
        this.queueWalk(m, [[m.home[0], m.home[1] + 8], [200, m.home[1] + 8], THRONE_FRONT], () => {
          m.say(fail ? '아뢰옵니다 — 일을 끝내지 못했사옵니다' : ph.stopLine, '', 2600);
          if (!fail) this.showPlaque(ph.stop || '상소 완료', 2800);
          setTimeout(() => {
            m.carry = false;
            this.queueWalk(m, [[200, m.home[1] + 8], [m.home[0], m.home[1] + 8], m.home]);
          }, this.reduced ? 1500 : 2400);
        });
        break;
      }
      case 'SessionEnd': {
        this.duskTarget = 1;
        const s = this.stats;
        this.showPlaque(`오늘 상소 ${s.petitions}건 · 윤허 ${s.ok} · 불허 ${s.no} · 보류 ${s.hold} · ${ph.sessionEnd || '퇴청하옵니다'}`, 6000);
        for (const o of [...this.officials.values()]) if (o.kind === 'seat' || o.kind === 'guest') this.leaveOfficial(o, '');
        break;
      }
      case 'PtyExit':
        this.duskTarget = 1;
        break;
      case 'PtyStart':
        this.duskTarget = 0;
        break;
      default:
        break;
    }
  }

  reset() {
    for (const o of [...this.officials.values()]) {
      if (o.kind === 'seat' || o.kind === 'guest') {
        o.remove();
        this.officials.delete(o.id);
        this.releaseSeat(o.seat);
      }
    }
    this.byAgent.clear();
    this.guestUsed.clear();
    this.walkQueue = [];
    this.walking = null;
    this.main.path = [];
    this.main.place(...this.main.home);
    this.main.state = 'seated';
    this.main.carry = false;
    this.main.hush();
    this.closePetition(null);
    this.stats = { petitions: 0, ok: 0, no: 0, hold: 0 };
    this.duskTarget = 0;
  }

  // ---------- frame ----------
  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const g = this.ctx;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.bg, 0, 0);
    const px = (x, y, w, h, c) => {
      g.fillStyle = c;
      g.fillRect(x, y, w, h);
    };
    // throne glow when a petition is waiting
    if (this.petition && !this.petition.closed) {
      const a = 0.12 + 0.06 * Math.sin(now / 300);
      px(150, 40, 100, 40, `rgba(217,174,82,${a.toFixed(3)})`);
    }
    this.drawKing(now, px);
    const list = [...this.officials.values()];
    for (const o of list) o.step(dt, now);
    list.sort((a, b) => a.y - b.y);
    for (const o of list) o.draw(g, now, px);
    // dusk tint (session end)
    this.dusk += (this.duskTarget - this.dusk) * Math.min(1, dt * 1.5);
    if (this.dusk > 0.01) px(0, 0, W, H, `rgba(8,10,20,${(this.dusk * 0.45).toFixed(3)})`);
    for (const o of list) o.updateDom(now);
    this.layoutBubbles();
    if (this.petition && !this.petition.closed) {
      this.petWait.textContent = fmt(this.ph.waiting, { elapsed: elapsedText(now - this.petition.since).replace('째', '') });
    }
  }

  // Speech bubbles: newest first (the petitioner always), at most MAX_BUBBLES.
  // Each one tries a few spots around its speaker and takes the first that overlaps
  // neither an earlier bubble nor the petition panel. Everything is also in the 사관 일지.
  layoutBubbles() {
    const on = [...this.officials.values()].filter((o) => o.bubbleOn);
    const asker = this.petition && !this.petition.closed ? this.petition.actor : null;
    on.sort((a, b) => (b === asker) - (a === asker) || (b.bubbleAt || 0) - (a.bubbleAt || 0));
    const placed = [];
    if (this.pet.classList.contains('on')) {
      placed.push({ x: PETITION_BOX.x, y: PETITION_BOX.y, w: PETITION_BOX.w, h: this.pet.offsetHeight || 64 });
    }
    const hit = (r) => placed.some((p) => r.x < p.x + p.w + 2 && r.x + r.w + 2 > p.x && r.y < p.y + p.h + 2 && r.y + r.h + 2 > p.y);
    let hidden = 0;
    for (const o of on) {
      if (placed.length - (this.pet.classList.contains('on') ? 1 : 0) >= MAX_BUBBLES) {
        o.bubble.classList.remove('on');
        hidden++;
        continue;
      }
      o.bubble.classList.add('on');
      const w = o.bubble.offsetWidth;
      const h = o.bubble.offsetHeight;
      const [ax, ay] = o.anchor;
      const step = h + 3;
      const side = Math.round(w * 0.55);
      const tries = [[0, 0], [0, -step], [-side, 0], [side, 0], [-side, -step], [side, -step], [0, -2 * step], [0, step + 30]];
      let best = null;
      for (const [dx, dy] of tries) {
        const x = Math.max(2, Math.min(W - 2 - w, ax + dx - w / 2));
        const y = Math.max(2, Math.min(H - 2 - h, ay + dy - h));
        const r = { x, y, w, h };
        if (!best) best = r;
        if (!hit(r)) {
          best = r;
          break;
        }
      }
      placed.push(best);
      // the tail only makes sense when the bubble sits right above its speaker
      o.bubble.classList.toggle('loose', Math.abs(best.x + w / 2 - ax) > w / 2 - 4 || Math.abs(best.y + h - ay) > 2);
      o.bubble.style.transform = `translate(${Math.round(best.x)}px, ${Math.round(best.y)}px)`;
    }
    this.more.textContent = hidden ? `말풍선 +${hidden} · 사관 일지에 있사옵니다` : '';
    this.more.classList.toggle('on', hidden > 0);
  }

  // The king: a generic pixel monarch on the throne (no historical likeness).
  // Frames: idle (blink), decree (holds up a scroll), nod (approve), wave (refuse).
  kingDo(kind, dur) {
    this.kingAnim = { kind, start: performance.now(), dur };
  }

  drawKing(now, px) {
    const P = this.pix;
    const kc = this.cfg.king || {};
    const robe = /^#/.test(kc.robe || '') ? kc.robe : P[kc.robe || 'hong'] || P.hong;
    const robeD = shade(robe, 0.72);
    const O = P.outline;
    const ox = 184;
    const oy = 33;
    const r = (x, y, w, h, c) => px(ox + x, oy + y, w, h, c);
    let a = this.kingAnim;
    if (a && (now - a.start) / 1000 > a.dur) a = this.kingAnim = null;
    const t = a ? (now - a.start) / 1000 : 0;
    const f = Math.floor(t * FPS);
    const kind = a ? a.kind : 'idle';
    const nod = kind === 'nod' && !this.reduced && (f % 4 === 1 || f % 4 === 2) ? 2 : 0;
    // robe (gonryongpo), seated
    const rows = [[10, 12], [8, 16], [7, 18], [7, 18], [6, 20], [6, 20], [6, 20], [6, 20], [6, 20], [5, 22], [5, 22], [5, 22], [5, 22], [5, 22], [5, 22], [5, 22]];
    rows.forEach(([x0, w], i) => {
      r(x0 - 1, 14 + i, w + 2, 1, O);
      r(x0, 14 + i, w, 1, robe);
    });
    r(4, 30, 24, 1, O);
    r(13, 14, 6, 1, P.paper); // collar
    // shoulder roundels + chest roundel (plain gold circle — no dragon)
    r(8, 15, 3, 3, P.hwang);
    r(21, 15, 3, 3, P.hwang);
    r(13, 16, 6, 1, P.hwang);
    r(12, 17, 8, 5, P.hwang);
    r(13, 22, 6, 1, P.hwang);
    r(14, 18, 4, 3, shade(robe, 0.85));
    r(15, 19, 2, 1, P.hwang);
    // jade belt
    r(6, 24, 20, 1, P.hwang);
    for (let x = 7; x < 26; x += 3) r(x, 24, 1, 1, P.paper);
    // arms
    if (kind === 'decree') {
      // both hands hold an opened scroll in front of the chest
      r(4, 15, 3, 6, robeD);
      r(25, 15, 3, 6, robeD);
      r(3, 13, 26, 8, O);
      r(4, 14, 24, 6, P.paper);
      r(3, 13, 2, 8, P.hwang);
      r(27, 13, 2, 8, P.hwang);
      for (let x = 8; x < 25; x += 4) r(x, 16, 2, 1, '#8A8378');
      r(5, 20, 2, 2, P.skin);
      r(25, 20, 2, 2, P.skin);
    } else if (kind === 'wave') {
      r(5, 18, 3, 7, robeD);
      r(5, 25, 3, 2, P.skin);
      const up = f % 2 === 0 ? 0 : 2;
      r(24, 18, 6, 3, robeD);
      r(29, 15 + up, 3, 3, P.skin);
    } else {
      // hands resting on the knees
      r(5, 18, 3, 7, robeD);
      r(24, 18, 3, 7, robeD);
      r(8, 26, 3, 2, P.skin);
      r(21, 26, 3, 2, P.skin);
    }
    // head (moves for the nod)
    const hy = nod;
    r(11, 7 + hy, 10, 7, O);
    r(12, 7 + hy, 8, 6, P.skin);
    r(12, 12 + hy, 8, 1, P.skinShade);
    const blink = now % 5000 < 140;
    if (blink || nod) {
      r(14, 10 + hy, 1, 1, P.skinShade);
      r(17, 10 + hy, 1, 1, P.skinShade);
    } else {
      r(14, 9 + hy, 1, 2, O);
      r(17, 9 + hy, 1, 2, O);
    }
    // ikseongwan: rounded crown + two upright back flaps
    r(11, 1 + hy, 10, 7, O);
    r(12, 2 + hy, 8, 5, P.heuk);
    r(13, 2 + hy, 6, 1, shade(P.heuk, 1.6));
    r(12, 6 + hy, 8, 1, shade(P.heuk, 1.3));
    r(8, 0 + hy, 4, 5, O);
    r(9, 1 + hy, 2, 3, P.heuk);
    r(20, 0 + hy, 4, 5, O);
    r(21, 1 + hy, 2, 3, P.heuk);
  }
}
