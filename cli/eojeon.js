#!/usr/bin/env node
// eojeon CLI
//   eojeon [--port N] [--cwd DIR] [--no-open]   start the court (server + browser)
//   eojeon demo [--port N]                      replay a scripted session, no claude needed
//   eojeon init [DIR] [--pack yukjo|studio|all] copy subagent files into DIR/.claude/agents (never overwrites)
//   eojeon watch [--off]                        also show Claude Code sessions running outside the court
//   eojeon --help | --version
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const argv = process.argv.slice(2);

const HELP = `어전 · eojeon ${pkg.version} — Claude Code as a royal court (unofficial)

Usage
  eojeon [options]              Start the court and open http://localhost:4747
  eojeon demo [options]         Replay a scripted session (no claude, no usage)
  eojeon init [dir] [--pack P]  Add the Six Ministries (육조) subagents to dir/.claude/agents
                                P = yukjo (default) | studio | all. Existing files are never overwritten.
  eojeon watch [--off]          Also show Claude Code sessions you run elsewhere (any terminal or IDE),
                                watch-only. Adds hooks to ~/.claude/settings.json (backup kept); --off removes them.

Options
  --port <n>     Port to listen on (default 4747; the next free port is used if taken)
  --cwd <dir>    Default project folder shown in the launcher (default: current folder)
  --host <addr>  Also open to other devices (e.g. 0.0.0.0, or your Tailscale IP). Needs the access key
                 printed at start; whoever has it can use your claude terminal.
  --new-key      With --host: make a new access key (old addresses stop working)
  --no-open      Do not open a browser
  -h, --help     Show this help
  -v, --version  Show the version

By default everything runs on 127.0.0.1 only. Docs: ${pkg.homepage}`;

function takeOpt(list, name) {
  const i = list.indexOf(name);
  if (i < 0) return undefined;
  const v = list[i + 1];
  list.splice(i, v !== undefined && !v.startsWith('-') ? 2 : 1);
  return v !== undefined && !v.startsWith('-') ? v : '';
}

if (argv.includes('-h') || argv.includes('--help') || argv[0] === 'help') {
  console.log(HELP);
  process.exit(0);
}
if (argv.includes('-v') || argv.includes('--version')) {
  console.log(pkg.version);
  process.exit(0);
}

const cmd = argv[0] && !argv[0].startsWith('-') ? argv.shift() : 'start';

if (cmd === 'init') {
  const { install, PACKS } = await import('../server/agents.js');
  const pack = takeOpt(argv, '--pack') || 'yukjo';
  if (![...PACKS, 'all'].includes(pack)) {
    console.error(`Unknown pack "${pack}". Use: ${PACKS.join(' | ')} | all`);
    process.exit(2);
  }
  const dir = path.resolve(argv.find((a) => !a.startsWith('-')) || process.env.INIT_CWD || process.cwd());
  try {
    const r = install(dir, pack);
    console.log(`어전 · eojeon init → ${r.dir}`);
    console.log(`  added   (${r.copied.length}): ${r.copied.join(', ') || '-'}`);
    console.log(`  skipped (${r.skipped.length}): ${r.skipped.join(', ') || '-'}${r.skipped.length ? '  (already there, left untouched)' : ''}`);
    console.log('  Restart Claude Code (or open /agents) to pick them up.');
  } catch (e) {
    console.error(`init failed: ${e.message}`);
    process.exit(1);
  }
} else if (cmd === 'watch') {
  const watch = await import('../server/watch.js');
  try {
    if (argv.includes('--off')) {
      const r = watch.uninstall();
      console.log(`어전 · eojeon watch off → removed our hooks from ${r.settingsFile}`);
    } else if (argv.includes('--status')) {
      console.log(watch.status() ? 'on' : 'off');
    } else {
      const r = watch.install();
      console.log(`어전 · eojeon watch on → ${r.settingsFile}`);
      if (r.backup) console.log(`  backup: ${r.backup}`);
      console.log('  Claude Code sessions started from now on (any terminal, IDE) appear in the court while it runs.');
      console.log('  Watch-only: answer their permission prompts in their own terminal. Turn off: eojeon watch --off');
      console.log('  Already-open sessions: run /hooks once (or restart) so they pick up the new hooks.');
    }
  } catch (e) {
    console.error(`watch failed: ${e.message}`);
    process.exit(1);
  }
} else if (cmd === 'start' || cmd === 'demo') {
  const pass = [...argv];
  if (cmd === 'demo' && !pass.includes('--demo')) pass.push('--demo');
  process.argv = [process.argv[0], path.join(ROOT, 'server', 'index.js'), ...pass];
  await import('../server/index.js');
} else {
  console.error(`Unknown command "${cmd}".\n`);
  console.log(HELP);
  process.exit(2);
}
