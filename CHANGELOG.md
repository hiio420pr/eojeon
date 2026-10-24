# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

## [0.2.0] - 2026-10-24

Fixes from the first day of use.

### Added
- `eojeon watch` / `eojeon watch --off`: show Claude Code sessions running outside the court (other terminals, IDEs), watch-only. Hooks go into `~/.claude/settings.json` (backup kept, only our entries are removed on `--off`); the hook copy lives in `~/.eojeon/hook/` and finds the court through `~/.eojeon/runtime.json`.
- `--host <addr>` (and `--new-key`): open the court to other devices, e.g. over Tailscale. Requires an access key printed at start (`?key=…` once, then an HttpOnly cookie for 30 days). The terminal still answers on 127.0.0.1 without a key.
- 전령 (`jeollyeong`) office for an SNS-posting agent.

### Changed
- One input on computers: the terminal. The 교지 쓰기 bar now shows only on touch screens.
- Petitions from outside sessions show "그 터미널에서 답하소서" instead of stamps; their log lines are tagged with the folder.

## [0.1.0] - 2026-10-24

First public version.

### Added
- Pixel-art Joseon court around your real Claude Code CLI (PTY + xterm.js), driven by hooks injected with `claude --settings <temp file>`.
- Scenes for decree (prompt), tool use, subagent enter/report/leave, permission petition with 윤허/불허/보류 stamps that send the real keys, failure ink blots, end of day.
- 사관 일지 (event log), 교지 쓰기 input for Korean IME, session picker (`--continue`, `--resume <id>`), permission mode picker (`--permission-mode`: manual, acceptEdits, plan, auto, dontAsk).
- 육조 (Six Ministries) default subagents: `ijo`, `hojo`, `yejo`, `byeongjo`, `hyeongjo`, `gongjo`, and the optional `studio` pack (11 roles).
- First-run prompt "육조를 들이시겠사옵니까?" and `eojeon init [dir] [--pack yukjo|studio|all]`; existing files are never overwritten.
- CLI `eojeon` (`demo`, `init`, `--port`, `--cwd`, `--no-open`, `--help`, `--version`) for `npx eojeon-cli`.
- Claude Code plugin and single-plugin marketplace (`/plugin install eojeon@eojeon`) with the `/eojeon` skill and the six agents as `eojeon:*`.
- Speech bubbles avoid each other and the petition panel; at most three at once, the rest stay in the log.
- 4-frame walk cycle with arm swing.

### Security
- Server binds to 127.0.0.1; Host/Origin checks on HTTP, WebSocket and the agent-install endpoint; per-run hook token.
- Hook payloads trimmed and secrets masked before leaving the hook process.
- `scripts/check-publish.js` blocks publishing local paths, e-mail addresses or token-shaped strings.

[0.2.0]: https://github.com/hiio420pr/eojeon/releases/tag/v0.2.0
[0.1.0]: https://github.com/hiio420pr/eojeon/releases/tag/v0.1.0
