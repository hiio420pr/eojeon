// `eojeon watch`: show Claude Code sessions that run outside the court (any terminal, IDE, ...).
// Adds one hook command per event to ~/.claude/settings.json. The command runs a copy of hook.js
// kept in ~/.eojeon/hook/ (a stable path, unlike the npx cache), which looks for a running court
// in ~/.eojeon/runtime.json and exits at once when there is none.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'PermissionDenied', 'SubagentStart', 'SubagentStop', 'Notification',
  'Stop', 'StopFailure', 'SessionEnd',
];

const MARK = path.join('.eojeon', 'hook', 'hook.js');
const isOurs = (h) => typeof h?.command === 'string' && h.command.replace(/\\/g, '/').includes(MARK.replace(/\\/g, '/'));

export function eojeonDir(home = os.homedir()) {
  return path.join(home, '.eojeon');
}

export function runtimeFile(home = os.homedir()) {
  return path.join(eojeonDir(home), 'runtime.json');
}

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${file} 을 읽지 못했습니다(JSON 오류). 손대지 않았습니다: ${e.message}`);
  }
}

function writeSettings(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.eojeon-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// drop our entries, keep everything else exactly as the user had it
function strip(hooks) {
  const out = {};
  for (const [ev, groups] of Object.entries(hooks || {})) {
    if (!Array.isArray(groups)) {
      out[ev] = groups;
      continue;
    }
    const kept = groups
      .map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) } : g))
      .filter((g) => !Array.isArray(g?.hooks) || g.hooks.length > 0);
    if (kept.length) out[ev] = kept;
  }
  return out;
}

export function install({ home = os.homedir(), node = process.execPath } = {}) {
  const settingsFile = path.join(home, '.claude', 'settings.json');
  const settings = readSettings(settingsFile); // throws before anything is written
  const dir = path.join(eojeonDir(home), 'hook');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const f of ['hook.js', 'sanitize.js']) fs.copyFileSync(path.join(HERE, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }\n');
  const backup = `${settingsFile}.eojeon-backup`;
  if (fs.existsSync(settingsFile) && !fs.existsSync(backup)) fs.copyFileSync(settingsFile, backup);

  const q = (s) => `"${s.replace(/"/g, '\\"')}"`;
  const command = `${q(node)} ${q(path.join(dir, 'hook.js'))} --watch`;
  const hooks = strip(settings.hooks);
  for (const ev of HOOK_EVENTS) hooks[ev] = [...(hooks[ev] || []), { hooks: [{ type: 'command', command, timeout: 5 }] }];
  writeSettings(settingsFile, { ...settings, hooks });
  return { settingsFile, backup: fs.existsSync(backup) ? backup : null, command };
}

export function uninstall({ home = os.homedir() } = {}) {
  const settingsFile = path.join(home, '.claude', 'settings.json');
  const settings = readSettings(settingsFile);
  const hooks = strip(settings.hooks);
  const next = { ...settings };
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  if (fs.existsSync(settingsFile)) writeSettings(settingsFile, next);
  fs.rmSync(path.join(eojeonDir(home), 'hook'), { recursive: true, force: true });
  return { settingsFile };
}

export function status({ home = os.homedir() } = {}) {
  const settings = readSettings(path.join(home, '.claude', 'settings.json'));
  return HOOK_EVENTS.every((ev) => (settings.hooks?.[ev] || []).some((g) => (g?.hooks || []).some(isOurs)));
}
