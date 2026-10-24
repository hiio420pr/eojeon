// Demo mode: replays a scripted session (fake hook events + a fake terminal
// transcript) without running claude. Used for screenshots and promo videos.
// URL params: ?demo=1  [&speed=2]  [&stop=<seconds>  → play up to that moment, then hold]

const ESC = '\x1b[';
const dim = (s) => `${ESC}2m${s}${ESC}0m`;
const bold = (s) => `${ESC}1m${s}${ESC}0m`;
const orange = (s) => `${ESC}38;5;209m${s}${ESC}0m`;
const green = (s) => `${ESC}32m${s}${ESC}0m`;
const red = (s) => `${ESC}31m${s}${ESC}0m`;
const nl = '\r\n';

const SID = 'demo-0000-4a1c-9d2e-000000000001';
const base = { session: SID, folder: 'my-app' };

const BANNER =
  dim('[데모 모드 — 실제 claude 가 아니라 녹화용 재생 화면입니다]') + nl + nl +
  orange(' ▐▛███▜▌') + '   ' + bold('Claude Code') + nl +
  orange('▝▜█████▛▘') + '  ' + dim('~/projects/my-app') + nl +
  orange('  ▘▘ ▝▝') + nl + nl;

const PROMPT_LINE = (s) => `${dim('>')} ${s}${nl}${nl}`;

// [time (s), action]
export const SCRIPT = [
  [0.0, { out: BANNER }],
  [0.2, { ev: { type: 'SessionStart', source: 'startup', model: 'claude-opus-5-5' } }],
  [2.0, { out: PROMPT_LINE('로그인 화면에 비밀번호 보기 버튼 넣고, 문구 다듬고, 테스트 돌려 줘') }],
  [2.1, { ev: { type: 'UserPromptSubmit', prompt: '로그인 화면에 비밀번호 보기 버튼 넣고, 문구 다듬고, 테스트 돌려 줘', slash: false } }],
  [4.6, { out: `${orange('⏺')} ${bold('Read')}(src/screens/Login.jsx)${nl}` }],
  [4.6, { ev: { type: 'PreToolUse', tool: 'Read', summary: 'src/screens/Login.jsx', toolUseId: 't1' } }],
  [5.6, { ev: { type: 'PostToolUse', tool: 'Read', summary: 'src/screens/Login.jsx', toolUseId: 't1', ms: 14 } }],
  [5.7, { out: `  ${dim('⎿  Read 142 lines')}${nl}${nl}` }],
  [6.2, { out: `${orange('⏺')} ${bold('Task')}(gongjo · 비밀번호 보기 버튼)${nl}` }],
  [6.2, { ev: { type: 'PreToolUse', tool: 'Task', summary: 'gongjo · 비밀번호 보기 버튼', spawnType: 'gongjo', toolUseId: 't2' } }],
  [6.5, { ev: { type: 'SubagentStart', agentId: 'a1', agentType: 'gongjo' } }],
  [7.0, { out: `${orange('⏺')} ${bold('Task')}(hyeongjo · 로그인 화면 리뷰)${nl}` }],
  [7.0, { ev: { type: 'PreToolUse', tool: 'Task', summary: 'hyeongjo · 로그인 화면 리뷰', spawnType: 'hyeongjo', toolUseId: 't3' } }],
  [7.3, { ev: { type: 'SubagentStart', agentId: 'a2', agentType: 'hyeongjo' } }],
  [12.0, { ev: { type: 'PreToolUse', tool: 'Edit', summary: 'src/screens/Login.jsx', toolUseId: 't4', agentId: 'a1', agentType: 'gongjo' } }],
  [12.0, { out: `  ${dim('⎿')}  ${bold('Edit')}(src/screens/Login.jsx)${nl}` }],
  [13.0, { ev: { type: 'PreToolUse', tool: 'Grep', summary: '"로그인" · src', toolUseId: 't5', agentId: 'a2', agentType: 'hyeongjo' } }],
  [13.0, { out: `  ${dim('⎿')}  ${bold('Grep')}("로그인", src)${nl}` }],
  [8.0, { out: `${orange('⏺')} ${bold('Task')}(eojeon:yejo · 변경 기록)${nl}` }],
  [8.0, { ev: { type: 'PreToolUse', tool: 'Task', summary: 'eojeon:yejo · 변경 기록', spawnType: 'eojeon:yejo', toolUseId: 't9' } }],
  [8.3, { ev: { type: 'SubagentStart', agentId: 'a3', agentType: 'eojeon:yejo' } }],
  [14.2, { ev: { type: 'PreToolUse', tool: 'Edit', summary: 'CHANGELOG.md', toolUseId: 't10', agentId: 'a3', agentType: 'eojeon:yejo' } }],
  [13.6, { ev: { type: 'PreToolUse', tool: 'Bash', summary: 'npx eslint src/screens', toolUseId: 't6' } }],
  [16.5, { ev: { type: 'PostToolUseFailure', tool: 'Bash', summary: 'npx eslint src/screens', toolUseId: 't6' } }],
  [16.5, { out: `${orange('⏺')} ${bold('Bash')}(npx eslint src/screens)${nl}  ${red('⎿  Error: 1 problem (1 error)')}${nl}` }],
  [17.0, { ev: { type: 'PostToolUse', tool: 'Grep', summary: '"로그인" · src', toolUseId: 't5', agentId: 'a2', agentType: 'hyeongjo', ms: 40 } }],
  [17.5, { ev: { type: 'PostToolUse', tool: 'Edit', summary: 'src/screens/Login.jsx', toolUseId: 't4', agentId: 'a1', agentType: 'gongjo', ms: 22 } }],
  [18.5, { ev: { type: 'SubagentStop', agentId: 'a1', agentType: 'gongjo', report: '보기 버튼 넣고 접근성 라벨 달았습니다' } }],
  [18.6, { out: `  ${green('⎿  Done')} ${dim('(gongjo · 3 tool uses)')}${nl}` }],
  [18.0, { ev: { type: 'PostToolUse', tool: 'Edit', summary: 'CHANGELOG.md', toolUseId: 't10', agentId: 'a3', agentType: 'eojeon:yejo', ms: 18 } }],
  [20.2, { ev: { type: 'SubagentStop', agentId: 'a3', agentType: 'eojeon:yejo', report: 'CHANGELOG 에 한 줄 적었습니다' } }],
  [19.2, { ev: { type: 'SubagentStop', agentId: 'a2', agentType: 'hyeongjo', report: '막을 문제 없음 · 사소한 것 1건' } }],
  [19.3, { out: `  ${green('⎿  Done')} ${dim('(hyeongjo · 2 tool uses)')}${nl}${nl}` }],
  [26.0, { ev: { type: 'PreToolUse', tool: 'Bash', summary: 'npm test', toolUseId: 't7' } }],
  [26.1, { ev: { type: 'PermissionRequest', tool: 'Bash', summary: 'npm test' } }],
  [26.1, {
    out:
      `${orange('⏺')} ${bold('Bash')}(npm test)${nl}${nl}` +
      ` ${bold('Bash command')}${nl}${nl}   npm test${nl}   ${dim('Run the test suite')}${nl}${nl}` +
      ` Do you want to proceed?${nl} ${orange('❯')} 1. Yes${nl}   2. Yes, and don't ask again for ${bold('npm test')} commands${nl}   3. No, and tell Claude what to do differently ${dim('(esc)')}${nl}${nl}`,
  }],
  [26.8, { ev: { type: 'Notification', kind: 'permission_prompt', message: 'Claude needs your permission to use Bash' } }],
  [32.0, { press: 'ok' }],
  [32.4, { out: `  ${dim('⎿')}  ${green('Tests: 24 passed, 24 total')}${nl}${nl}` }],
  [33.0, { ev: { type: 'PostToolUse', tool: 'Bash', summary: 'npm test', toolUseId: 't7', ms: 2140 } }],
  [33.6, { ev: { type: 'PreToolUse', tool: 'Bash', summary: 'git diff --stat', toolUseId: 't8' } }],
  [34.6, { ev: { type: 'PostToolUse', tool: 'Bash', summary: 'git diff --stat', toolUseId: 't8', ms: 30 } }],
  [34.6, { out: `${orange('⏺')} ${bold('Bash')}(git diff --stat)${nl}  ${dim('⎿  2 files changed, 38 insertions(+), 6 deletions(-)')}${nl}${nl}` }],
  [35.5, { out: `${orange('⏺')} 비밀번호 보기 버튼을 넣고 문구를 다듬었습니다. 테스트 24개 모두 통과했습니다.${nl}${nl}` }],
  [35.6, { ev: { type: 'Stop' } }],
  [42.0, { ev: { type: 'Notification', kind: 'idle_prompt', message: 'Claude is waiting for your input' } }],
  [48.0, { end: true }],
];

export function runDemo({ term, onEvent, court, speed = 1, stopAt = null, loop = true }) {
  let timers = [];
  const play = () => {
    timers.forEach(clearTimeout);
    timers = [];
    term.reset();
    court.reset();
    for (const [t, a] of SCRIPT) {
      if (stopAt != null && t > stopAt) continue;
      timers.push(
        setTimeout(() => {
          if (a.out) term.write(a.out);
          if (a.ev) onEvent({ ...base, ...a.ev, time: Date.now() });
          if (a.press) court.petitionAction(a.press);
          if (a.end && loop) play();
        }, (t * 1000) / speed),
      );
    }
  };
  play();
}
