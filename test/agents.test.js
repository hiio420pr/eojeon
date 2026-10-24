import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, inspect, packFiles } from '../server/agents.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'eojeon-test-'));
const YUKJO = ['byeongjo', 'gongjo', 'hojo', 'hyeongjo', 'ijo', 'yejo'];

test('init copies the six ministries into .claude/agents', () => {
  const dir = tmp();
  const r = install(dir, 'yukjo');
  assert.deepEqual(r.copied.sort(), YUKJO);
  assert.deepEqual(r.skipped, []);
  for (const n of YUKJO) assert.ok(fs.existsSync(path.join(dir, '.claude', 'agents', `${n}.md`)));
  assert.deepEqual(inspect(dir, 'yukjo').missing, []);
});

test('init never overwrites an existing file with the same name', () => {
  const dir = tmp();
  const agents = path.join(dir, '.claude', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  const mine = '---\nname: gongjo\ndescription: my own builder\n---\nkeep me\n';
  fs.writeFileSync(path.join(agents, 'gongjo.md'), mine);
  fs.writeFileSync(path.join(agents, 'my-reviewer.md'), '---\nname: my-reviewer\ndescription: x\n---\n');
  const r = install(dir, 'yukjo');
  assert.deepEqual(r.skipped, ['gongjo']);
  assert.equal(r.copied.length, 5);
  assert.equal(fs.readFileSync(path.join(agents, 'gongjo.md'), 'utf8'), mine);
  // running again changes nothing
  const again = install(dir, 'yukjo');
  assert.deepEqual(again.copied, []);
  assert.equal(again.skipped.length, 6);
  const st = inspect(dir, 'yukjo');
  assert.ok(st.userAgents.some((a) => a.name === 'my-reviewer'));
});

test('pack "all" adds studio too, and unknown packs are refused', () => {
  const dir = tmp();
  const r = install(dir, 'all');
  assert.equal(r.copied.length, 6 + packFiles('studio').length);
  assert.throws(() => install(dir, 'nope'), /unknown pack/);
});

test('every template is a valid subagent file with no private details', () => {
  const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];
  for (const pack of ['yukjo', 'studio']) {
    for (const f of packFiles(pack)) {
      const text = fs.readFileSync(f.src, 'utf8');
      const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
      assert.ok(m, `${f.file}: no frontmatter`);
      const fm = Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
      assert.equal(fm.name, f.name, `${f.file}: name`);
      assert.match(fm.description, /Use proactively when/, `${f.file}: description trigger`);
      assert.equal(fm.model, 'inherit', `${f.file}: model`);
      assert.ok(COLORS.includes(fm.color), `${f.file}: color`);
      assert.ok(fm.tools && !/\*/.test(fm.tools), `${f.file}: tools`);
      assert.match(text, /Next action:/, `${f.file}: next action line`);
      assert.match(text, /Confidence:/, `${f.file}: confidence line`);
      assert.doesNotMatch(text, /\/Volumes\/|\/Users\/|하이아이오|hiio|나가는돈|aiweekly|사장님|@[a-z0-9-]+\.[a-z]/i, `${f.file}: private detail`);
    }
  }
  // read-only ministries stay read-only
  const tools = (n) => /^tools:\s*(.+)$/m.exec(fs.readFileSync(packFiles('yukjo').find((f) => f.name === n).src, 'utf8'))[1];
  for (const n of ['ijo', 'byeongjo']) assert.doesNotMatch(tools(n), /Edit|Write|Bash/);
  assert.doesNotMatch(tools('hyeongjo'), /Edit|Write/);
  assert.match(tools('hyeongjo'), /Bash/);
});
