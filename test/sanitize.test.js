import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, sanitize, toolSummary } from '../server/sanitize.js';

test('redact masks token-shaped strings', () => {
  const cases = [
    'curl -H "Authorization: Bearer abcdefghijklmnop" x',
    'export ANTHROPIC_API_KEY=sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV',
    'git remote add o https://ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123@github.com',
    'AWS_SECRET_ACCESS_KEY=abc123xyz ./run.sh',
    'aws --key AKIAABCDEFGHIJKLMNOP',
    'psql postgres://admin:hunter2@db.local/app',
    './deploy --password "p a s s"',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
  ];
  const secrets = ['abcdefghijklmnop', 'sk-ant-api03', 'ghp_ABCDEF', 'abc123xyz', 'AKIAABCDEFGHIJKLMNOP', 'hunter2', 'p a s s', 'MIIEow'];
  cases.forEach((c, i) => {
    const out = redact(c);
    assert.ok(!out.includes(secrets[i]), `leaked "${secrets[i]}" in: ${out}`);
    assert.ok(out.includes('***'), `no mask in: ${out}`);
  });
});

test('redact leaves ordinary commands alone', () => {
  assert.equal(redact('npm test -- --watch'), 'npm test -- --watch');
  assert.equal(redact('git status'), 'git status');
});

test('sanitize keeps only a short, redacted display event', () => {
  const ev = sanitize({
    hook_event_name: 'UserPromptSubmit',
    session_id: 's1',
    cwd: '/tmp/proj',
    prompt: 'use token=supersecretvalue and then ' + 'x'.repeat(500),
  });
  assert.equal(ev.type, 'UserPromptSubmit');
  assert.ok(!JSON.stringify(ev).includes('supersecretvalue'));
  assert.ok([...ev.prompt].length <= 60);
  assert.equal(ev.folder, 'proj');

  const post = sanitize({ hook_event_name: 'PostToolUse', tool_name: 'Read', cwd: '/tmp/proj', tool_input: { file_path: '/tmp/proj/a/b.js' }, tool_response: { content: 'TOP SECRET FILE BODY' } });
  assert.equal(post.summary, 'a/b.js');
  assert.ok(!JSON.stringify(post).includes('TOP SECRET'));
});

test('toolSummary shows only the first line of a command', () => {
  assert.equal(toolSummary('Bash', { command: 'echo hi\nrm -rf /' }), 'echo hi');
});
