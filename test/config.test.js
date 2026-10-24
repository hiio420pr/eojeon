import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lookupOfficial, resolveAgentType, titleOf } from '../public/court-types.js';
import { packFiles } from '../server/agents.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../court.config.json', import.meta.url), 'utf8'));

test('every yukjo agent has an office title and robe in court.config.json', () => {
  const want = { ijo: '이조판서', hojo: '호조판서', yejo: '예조판서', byeongjo: '병조판서', hyeongjo: '형조판서', gongjo: '공조판서' };
  for (const [k, title] of Object.entries(want)) {
    const r = lookupOfficial(k, cfg);
    assert.equal(r.kind, 'seat');
    assert.equal(r.def.title, title);
    assert.ok(['hong', 'cheong', 'nok'].includes(r.def.robe));
  }
});

test('every shipped template has a config entry', () => {
  for (const pack of ['yukjo', 'studio']) for (const f of packFiles(pack)) assert.ok(cfg.officials[f.name], `${f.name} missing in config`);
});

test('fixed desks are unique and stone letters do not repeat', () => {
  const seats = new Set();
  const letters = new Set();
  for (const [k, d] of Object.entries(cfg.officials)) {
    if (k.startsWith('_')) continue;
    if (Number.isInteger(d.seat)) {
      const s = `${d.side}:${d.seat}`;
      assert.ok(!seats.has(s), `desk ${s} used twice`);
      seats.add(s);
    }
    assert.ok(!letters.has(d.short), `stone letter ${d.short} repeats`);
    letters.add(d.short);
  }
});

test('plugin-namespaced agent types map to the same office', () => {
  assert.equal(resolveAgentType('eojeon:ijo', cfg), 'ijo');
  assert.equal(titleOf('eojeon:gongjo', cfg), '공조판서');
  assert.equal(lookupOfficial('Explore', cfg).kind, 'guest');
  assert.equal(lookupOfficial('', cfg).kind, 'main');
  const u = lookupOfficial('someones-own-agent', cfg);
  assert.equal(u.kind, 'unknown');
  assert.match(u.def.title, /^관리 · someones-own-agent$/);
});
