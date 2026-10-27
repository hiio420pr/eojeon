---
name: eojeon
description: Open 어전 (eojeon), the pixel-art royal court view of Claude Code, in the browser. Use when the user types /eojeon or asks to "open the court", "어전 열어줘", "어전 띄워줘", or wants to watch subagents work as court officials. Also explains how to add the Six Ministries (육조) subagents to a project.
argument-hint: "[init | demo | stop]"
allowed-tools: Bash(curl -s http://localhost:4747/api/info) Bash(npx -y eojeon-cli@0.5.1) Bash(npx -y eojeon-cli@0.5.1 demo) Bash(npx -y eojeon-cli@0.5.1 init)
---

# 어전 열기 (Open the court)

어전 runs a small local web server (127.0.0.1 only) that shows a Joseon throne hall above a real Claude Code terminal. Default address: http://localhost:4747

## 1. Reuse it if it is already running
Run:
```bash
curl -s http://localhost:4747/api/info
```
If the reply is JSON containing `"app":"eojeon"`, it is already up. Tell the user to open http://localhost:4747 and stop here. (Ports 4748–4757 are used when 4747 is taken; check those the same way only if the user says the address did not work.)

## 2. Otherwise start it in the background
Run this with the Bash tool's `run_in_background` option (it is a long-running server; never wait for it to exit):
```bash
npx -y eojeon-cli@0.5.1
```
It opens the browser by itself. Read the first lines of its output for the actual URL (it prints `http://localhost:<port>/`) and give that URL to the user. If the user asked for a demo without Claude, run `npx -y eojeon-cli@0.5.1 demo` instead.

In the browser the user picks a project folder, an optional permission mode, and presses 입궐 (start). Their real `claude` CLI runs inside the page; nothing is sent anywhere else.

## 3. 육조 들이기 (add the Six Ministries)
If the user asks for `init` or for the default officials in their project:
```bash
npx -y eojeon-cli@0.5.1 init
```
This copies six subagents (ijo, hojo, yejo, byeongjo, hyeongjo, gongjo) into `./.claude/agents/`. Existing files with the same name are never overwritten; the command lists what it added and skipped. `--pack studio` adds 11 product/design/marketing roles, `--pack all` both.

If this plugin is installed, the same six are already available as `eojeon:ijo` … `eojeon:gongjo`; running `init` as well gives duplicate copies, so suggest only one of the two.

## 4. Stop
The server stops with Ctrl+C in its terminal, or by stopping the background task. Do not kill other processes.

Requirements: Node.js 18+, Claude Code installed and logged in. Unofficial tool, not affiliated with Anthropic.
