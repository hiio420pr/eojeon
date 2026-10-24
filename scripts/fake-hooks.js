// Sends fake *raw* Claude Code hook payloads through the real hook script
// (server/hook.js → sanitize → POST) to a running `npm start` server.
// Tests the hook path end-to-end without spending any Claude usage.
// usage: npm run fake-hooks [-- --port 4747]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const i = process.argv.indexOf('--port');
const port = i > 0 ? Number(process.argv[i + 1]) : 4747;
const rtFile = path.join(os.tmpdir(), `eojeon-${port}.json`);
if (!fs.existsSync(rtFile)) {
  console.error(`No running server on port ${port} (missing ${rtFile}). Run \`npm start\` first.`);
  process.exit(1);
}
const { token, hook } = JSON.parse(fs.readFileSync(rtFile, 'utf8'));
const cwd = path.join(os.homedir(), 'projects', 'demo-app');
const common = { session_id: '11111111-2222-3333-4444-555555555555', transcript_path: path.join(cwd, 'x.jsonl'), cwd, permission_mode: 'default' };

const steps = [
  [0, { hook_event_name: 'SessionStart', source: 'startup', model: 'claude-opus-5-5' }],
  [1200, { hook_event_name: 'UserPromptSubmit', prompt: 'API 키 sk-test-FAKEFAKEFAKEFAKE 로 배포 스크립트 점검해 줘' }],
  [1500, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'f1', tool_input: { file_path: path.join(cwd, 'scripts/deploy.sh') } }],
  [700, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'f1', tool_input: { file_path: path.join(cwd, 'scripts/deploy.sh') }, tool_response: { content: 'TOP SECRET FILE BODY' }, duration_ms: 9 }],
  [600, { hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'data-analyst' }],
  [2500, { hook_event_name: 'PreToolUse', agent_id: 'ag1', agent_type: 'data-analyst', tool_name: 'Bash', tool_use_id: 'f2', tool_input: { command: 'AWS_SECRET_ACCESS_KEY=abc123xyz ./count.sh --token=tok_live_123' } }],
  [1500, { hook_event_name: 'PostToolUse', agent_id: 'ag1', agent_type: 'data-analyst', tool_name: 'Bash', tool_use_id: 'f2', tool_input: { command: 'x' }, duration_ms: 1200 }],
  [500, { hook_event_name: 'SubagentStop', agent_id: 'ag1', agent_type: 'data-analyst', last_assistant_message: '사용자 67명, 지난주보다 7명 늘었습니다. 자세한 표는 아래…' }],
  [3000, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'f3', tool_input: { command: 'rm -rf dist && npm run build' } }],
  [100, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf dist && npm run build' } }],
  [600, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }],
  [4000, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'f3', tool_input: { command: 'rm -rf dist && npm run build' }, duration_ms: 3000 }],
  [800, { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'done' }],
];

const send = (payload) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [hook, String(port), token], { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', (code) => resolve({ code, out }));
    p.stdin.end(JSON.stringify({ ...common, ...payload }));
  });

for (const [delay, payload] of steps) {
  await new Promise((r) => setTimeout(r, delay));
  const t0 = Date.now();
  const { code, out } = await send(payload);
  console.log(`${payload.hook_event_name.padEnd(18)} exit=${code} stdout=${JSON.stringify(out)} ${Date.now() - t0}ms`);
}
