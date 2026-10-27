# Privacy — Eojeon (어전)

Eojeon collects no data. There are no accounts, no analytics, no telemetry, and no server run by us.

- Everything runs on your own computer. The web page is served from 127.0.0.1 and talks only to that local server.
- It reads, on your computer only: the project folder you pick, your Claude Code session list under `~/.claude/projects` (to offer resume), and `.claude/agents` in that project. These are shown in the local page and are not sent anywhere.
- It writes, on your computer only: `~/.eojeon/` (its own runtime file), `.claude/agents/` when you run `init`, and `~/.claude/settings.json` only when you run `watch` (a backup is kept; `watch --off` removes the entries).
- Network: `npx` downloads the `eojeon-cli` package from the public npm registry. Your `claude` CLI talks to Anthropic exactly as it does without Eojeon. If you start Eojeon with `--host`, other devices that have the printed access key can open your court and terminal.

Questions: https://github.com/hiio420pr/eojeon/issues
