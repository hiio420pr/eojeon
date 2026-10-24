import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, uninstall, status, HOOK_EVENTS } from '../server/watch.js';

function fakeHome(settings) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'eojeon-home-'));
  if (settings !== undefined) {
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings));
  }
  return home;
}
const read = (home) => JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));

test('watch install keeps the user settings and hooks, and is idempotent', () => {
  const mine = { hooks: [{ type: 'command', command: 'echo mine' }] };
  const home = fakeHome({ model: 'opus', hooks: { Stop: [mine] } });
  install({ home, node: '/usr/bin/node' });
  install({ home, node: '/usr/bin/node' });
  const s = read(home);
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.hooks.Stop[0], mine);
  for (const ev of HOOK_EVENTS) {
    const ours = s.hooks[ev].flatMap((g) => g.hooks).filter((h) => h.command.includes('.eojeon/hook/hook.js'));
    assert.equal(ours.length, 1, ev);
  }
  assert.ok(fs.existsSync(path.join(home, '.eojeon', 'hook', 'hook.js')));
  assert.ok(fs.existsSync(path.join(home, '.eojeon', 'hook', 'sanitize.js')));
  assert.ok(fs.existsSync(path.join(home, '.claude', 'settings.json.eojeon-backup')));
  assert.equal(status({ home }), true);
});

test('watch --off removes only our hooks', () => {
  const mine = { hooks: [{ type: 'command', command: 'echo mine' }] };
  const home = fakeHome({ hooks: { Stop: [mine] } });
  install({ home });
  uninstall({ home });
  assert.deepEqual(read(home), { hooks: { Stop: [mine] } });
  assert.equal(status({ home }), false);
  assert.ok(!fs.existsSync(path.join(home, '.eojeon', 'hook')));
});

test('watch works without a settings file and refuses a broken one', () => {
  const empty = fakeHome();
  install({ home: empty });
  assert.equal(status({ home: empty }), true);
  const broken = fakeHome('{ not json');
  assert.throws(() => install({ home: broken }), /JSON/);
  assert.equal(fs.readFileSync(path.join(broken, '.claude', 'settings.json'), 'utf8'), '{ not json');
});
