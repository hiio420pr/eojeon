// Shared by the court server and `eojeon claude`: find the claude binary, load node-pty,
// and build a clean environment for a claude child process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function findClaude() {
  if (process.env.COURT_CLAUDE_BIN) return process.env.COURT_CLAUDE_BIN;
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const n of names) {
      const p = path.join(dir, n);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {}
    }
  }
  const local = path.join(os.homedir(), '.local', 'bin', 'claude');
  return fs.existsSync(local) ? local : null;
}

// node-pty ships prebuilt binaries for macOS (arm64/x64) and Windows (x64/arm64).
// On Linux the prebuilt fork @homebridge/node-pty-prebuilt-multiarch is used instead.
// Both are optionalDependencies so `npx eojeon-cli` never fails to install (demo still works).
const PTY_MODULES = ['node-pty', '@homebridge/node-pty-prebuilt-multiarch'];
let ptyMod = null;
export function loadPty() {
  if (ptyMod) return ptyMod;
  const errors = [];
  for (const name of PTY_MODULES) {
    try {
      ptyMod = require(name);
      return ptyMod;
    } catch (e) {
      errors.push(`${name}: ${String(e.message).split('\n')[0]}`);
    }
  }
  throw new Error(
    '터미널 모듈(node-pty)을 불러오지 못했습니다. `npm i -g eojeon` 으로 다시 설치하거나 빌드 도구(python3, make, C++ 컴파일러)를 설치해 주세요. ' +
      'Could not load node-pty. ' + errors.join(' | '),
  );
}

export function childEnv() {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '1' };
  // if the court itself was started from inside Claude Code, don't let the child think it's nested
  // (session-scoped markers only; user config such as CLAUDE_CODE_USE_BEDROCK is kept)
  for (const k of [
    'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID',
    'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_MESSAGING_SOCKET',
    'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_BRIDGE_SESSION_ID', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_PID', 'CLAUDE_EFFORT',
  ]) delete env[k];
  for (const k of Object.keys(env)) if (k.startsWith('npm_')) delete env[k];
  env.EOJEON_CHILD = '1'; // `eojeon watch` hooks skip this session (it already reports through --settings)
  return env;
}
