# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

## [0.5.0] - 2026-10-25

### Added
- 상소함: permission requests not answered yet and questions Claude stopped on (AskUserQuestion, or an answer ending with a question) pile up in a 상소함 tab and as a pile with a count on the court. They leave on their own when answered or when you send the next decree, or with 치우기. Kept in `~/.eojeon/pending.json` across restarts. Stamp buttons appear only on the request the terminal is showing now.

## [0.4.0] - 2026-10-25

### Changed
- Layout: the court takes the whole left side. The right panel has **답변** (your decrees and Claude's final answers only, as a conversation) and **사관 일지** tabs, a one-line "now working on" status, and the single input. The raw CLI screen opens only with the **터미널** button (opened automatically when you start claude from the page).
- The separate 교지 쓰기 bar is gone; the panel input is the one input (Enter sends, Shift+Enter for a new line).

### Privacy
- For the 답변 tab, hook events now carry your prompt (up to 2,000 chars) and Claude's final answer (up to 6,000 chars; from `last_assistant_message`, or the end of the session transcript on older Claude Code). Secrets are masked as before; they go only to this computer or keyed devices (`--host`).

## [0.3.2] - 2026-10-25

### Fixed
- Mirrored terminal (`eojeon claude`) no longer gets cut off: the web terminal shrinks its font until the whole screen fits, and the terminal pane gets more height while mirroring.
- Hooks keep reaching the court after it restarts: if the court that started claude is gone, the hook posts to the one now running (`~/.eojeon/runtime.json`).

## [0.3.1] - 2026-10-25

### Fixed
- `eojeon claude` no longer gives up when the court is busy (another claude already running in it) or not started yet: it keeps trying every 3 s and attaches as soon as the court is free, then makes claude redraw so the web shows the full screen.

## [0.3.0] - 2026-10-25

### Added
- `eojeon claude [claude flags…]`: run claude in your own terminal and mirror it into the running court. The web terminal shows the same screen (following that terminal's size), and web input and 윤허/불허 stamps go into it. Hooks are attached the same way as for the court's own claude. Without a running court it runs plain claude.

### Changed
- `server/pty.js` shares the claude lookup, node-pty loading and child environment between the server and `eojeon claude`.

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

[0.5.0]: https://github.com/hiio420pr/eojeon/releases/tag/v0.5.0
[0.4.0]: https://github.com/hiio420pr/eojeon/releases/tag/v0.4.0
[0.3.2]: https://github.com/hiio420pr/eojeon/releases/tag/v0.3.2
[0.3.1]: https://github.com/hiio420pr/eojeon/releases/tag/v0.3.1
[0.3.0]: https://github.com/hiio420pr/eojeon/releases/tag/v0.3.0
[0.2.0]: https://github.com/hiio420pr/eojeon/releases/tag/v0.2.0
[0.1.0]: https://github.com/hiio420pr/eojeon/releases/tag/v0.1.0
