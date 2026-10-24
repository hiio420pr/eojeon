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

test('답변 view: prompt text and final answer, secrets masked', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { sanitize: s } = await import('../server/sanitize.js');
  const p = s({ hook_event_name: 'UserPromptSubmit', prompt: 'deploy with API_KEY=abc123secret please' });
  assert.match(p.text, /API_KEY=\*\*\*/);
  assert.equal(s({ hook_event_name: 'Stop', last_assistant_message: 'done ✓' }).answer, 'done ✓');
  // older Claude Code: read the transcript tail
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eojeon-tr-')), 't.jsonl');
  const lines = [
    { type: 'user', message: { content: 'old question' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'old answer' }] } },
    { type: 'user', message: { content: 'new question' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'looking' }, { type: 'tool_use', name: 'Bash' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'final answer' }] } },
  ];
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.equal(s({ hook_event_name: 'Stop', transcript_path: f }).answer, 'looking\n\nfinal answer');
});
