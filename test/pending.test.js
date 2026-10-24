import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pending } from '../server/pending.js';

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eojeon-pend-')), 'p.json');

test('상소함: permission waits until answered, then leaves', () => {
  const p = new Pending(file());
  p.apply({ type: 'PermissionRequest', session: 's', tool: 'Bash', summary: 'rm -rf build', toolUseId: 'u1', time: 1 });
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].kind, 'perm');
  p.apply({ type: 'PostToolUse', session: 's', tool: 'Bash', toolUseId: 'u1', time: 2 });
  assert.equal(p.items.length, 0);
});

test('상소함: a question at the end of an answer waits for the next decree, and survives a restart', () => {
  const f = file();
  const p = new Pending(f);
  p.apply({ type: 'Stop', session: 's', answer: '다 했습니다.\n\n배포까지 할까요?', time: 3 });
  p.apply({ type: 'Stop', session: 't', answer: '끝났습니다.', time: 4 });
  assert.deepEqual(p.items.map((x) => x.text), ['배포까지 할까요?']);
  assert.equal(new Pending(f).items.length, 1); // kept in the file
  p.apply({ type: 'UserPromptSubmit', session: 's', time: 5 });
  assert.equal(p.items.length, 0);
});

test('상소함: AskUserQuestion and dismiss', () => {
  const p = new Pending(file());
  p.apply({ type: 'PreToolUse', session: 's', tool: 'AskUserQuestion', summary: '어느 쪽?', toolUseId: 'q1', time: 6 });
  assert.equal(p.items[0].text, '어느 쪽?');
  assert.ok(p.dismiss(p.items[0].id));
  assert.equal(p.items.length, 0);
});
