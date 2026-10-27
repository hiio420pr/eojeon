import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 플러그인 폴더(plugin/agents)의 육조는 init 이 복사하는 templates/agents/yukjo 와 같아야 한다.
test('plugin agents match yukjo templates', () => {
  const src = 'templates/agents/yukjo';
  for (const f of fs.readdirSync(src)) {
    assert.equal(fs.readFileSync(`plugin/agents/${f}`, 'utf8'), fs.readFileSync(`${src}/${f}`, 'utf8'), f);
  }
  assert.equal(fs.readdirSync('plugin/agents').length, fs.readdirSync(src).length);
});

// 디렉터리 심사는 고정되지 않은 npx 실행을 막는다. 스킬의 eojeon-cli 는 package.json 버전과 같아야 한다.
test('skill pins eojeon-cli to the package version', () => {
  const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const skill = fs.readFileSync('plugin/skills/eojeon/SKILL.md', 'utf8');
  const pins = [...skill.matchAll(/eojeon-cli@([\w.-]+)/g)].map((m) => m[1]);
  assert.ok(pins.length > 0);
  for (const v of pins) assert.equal(v, version);
});
