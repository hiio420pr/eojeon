# Eojeon (어전)

Eojeon wraps your real Claude Code CLI in a pixel-art Joseon royal court that runs in your browser. You issue a decree (a prompt), officials (subagents) walk into the throne hall and work at their desks, and when Claude Code needs a permission it arrives as a petition you can approve, deny, or hold. Unofficial tool, not affiliated with Anthropic.

![The court while officials work](https://raw.githubusercontent.com/hiio420pr/eojeon/main/docs/screenshot-working.png)

## Install

```
/plugin install eojeon --marketplace hiio420pr/eojeon
```

On Claude Code older than 2.1.275: `/plugin marketplace add hiio420pr/eojeon`, then `/plugin install eojeon@eojeon`.

## What this plugin adds

- **`/eojeon` skill**: opens the court. It first checks whether a court is already running on `http://localhost:4747`; if not, it starts one with `npx -y eojeon-cli@0.5.1` and gives you the address. `/eojeon demo` replays a scripted session without calling Claude. `/eojeon init` copies the Six Ministries agents into the current project.
- **Six Ministries (육조) subagents**: `eojeon:ijo` (planner), `eojeon:hojo` (performance), `eojeon:yejo` (docs), `eojeon:byeongjo` (security), `eojeon:hyeongjo` (review), `eojeon:gongjo` (implementation).

## What it runs, reads, and sends

- **Downloads**: `npx` fetches the `eojeon-cli` package (pinned to 0.5.1) from the public npm registry the first time. Source: https://github.com/hiio420pr/eojeon (MIT).
- **Runs locally**: a small web server bound to 127.0.0.1 only, and your own `claude` CLI inside a terminal (PTY) on that page. Nothing is sent to any other server; there is no analytics or telemetry.
- **Reads**: the project folder you choose, your Claude Code session list under `~/.claude/projects` (to offer resume), and `.claude/agents` in that project.
- **Writes**: `~/.eojeon/` (runtime file for its own hooks), `.claude/agents/` only when you run `init` (existing files are never overwritten), and `~/.claude/settings.json` only if you explicitly run `npx eojeon-cli watch` (a backup is kept; `watch --off` removes it).
- **Optional remote access**: only when you start it with `--host`; it then prints an access key, and anyone with that key can use your terminal.

Requirements: Node.js 18+ and Claude Code installed and logged in. Full documentation: https://github.com/hiio420pr/eojeon

## Privacy

No data is collected. Details: [Privacy](https://github.com/hiio420pr/eojeon/blob/main/PRIVACY.md)

## License

MIT. Bundled with the npm package (not this plugin folder): Galmuri and D2Coding fonts under the SIL Open Font License 1.1.
