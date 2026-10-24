// Lists past Claude Code sessions for a folder, newest first, by reading
// ~/.claude/projects/<encoded cwd>/*.jsonl (read-only, only the start and end of each file).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function projectsRoot() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

// Claude Code stores a project under its absolute path with every non-alphanumeric char turned into '-'.
// (Claude Code sees the real path, e.g. /tmp/x on macOS is /private/tmp/x.)
export function encodeProjectPath(cwd) {
  let p = path.resolve(cwd);
  try {
    p = fs.realpathSync(p);
  } catch {}
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

function readSlice(fd, start, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, start);
  return b.subarray(0, n).toString('utf8');
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const t = content.find((c) => c && c.type === 'text' && typeof c.text === 'string');
    return t ? t.text : '';
  }
  return '';
}

function isRealPrompt(t) {
  if (!t) return false;
  const s = t.trim();
  if (!s) return false;
  // command wrappers, caveats, hook/system injections
  return !/^<(command-|local-command|system-reminder|user-prompt-submit-hook|bash-|task-notification)/.test(s) && !s.startsWith('Caveat:');
}

function clip(s, n) {
  const one = s.replace(/\s+/g, ' ').trim();
  const chars = [...one];
  return chars.length > n ? chars.slice(0, n).join('') + '…' : one;
}

export function summarize(file) {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  try {
    const head = readSlice(fd, 0, Math.min(st.size, 512 * 1024));
    const tail = st.size > 512 * 1024 ? readSlice(fd, Math.max(0, st.size - 128 * 1024), 128 * 1024) : head;
    let first = '';
    let title = '';
    let aiTitle = '';
    let cwd = '';
    for (const line of head.split('\n')) {
      if (!line.startsWith('{')) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (!cwd && typeof o.cwd === 'string') cwd = o.cwd;
      if (o.type === 'custom-title' && o.customTitle) title = o.customTitle;
      if (o.type === 'ai-title' && o.aiTitle) aiTitle = o.aiTitle;
      if (!first && o.type === 'user' && !o.isMeta && !o.isSidechain && o.message) {
        const t = textOf(o.message.content);
        if (isRealPrompt(t)) first = t;
      }
    }
    for (const line of tail.split('\n')) {
      if (line.includes('"custom-title"') || line.includes('"ai-title"')) {
        try {
          const o = JSON.parse(line);
          if (o.customTitle) title = o.customTitle;
          if (o.aiTitle) aiTitle = o.aiTitle;
        } catch {}
      }
    }
    title = title || aiTitle;
    return { first: first ? clip(first, 40) : '', title: title ? clip(title, 40) : '', cwd };
  } finally {
    fs.closeSync(fd);
  }
}

export function listSessions(cwd, limit = 30) {
  const dir = path.join(projectsRoot(), encodeProjectPath(cwd));
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const rows = files
    .map((f) => {
      const p = path.join(dir, f);
      try { return { id: f.slice(0, -6), p, mtime: fs.statSync(p).mtimeMs }; } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit * 2);
  const out = [];
  for (const r of rows) {
    if (!/^[0-9a-f-]{36}$/i.test(r.id)) continue;
    let s;
    try { s = summarize(r.p); } catch { continue; }
    if (!s.first && !s.title) continue; // empty / tool-only sessions can't be resumed meaningfully
    out.push({ id: r.id, title: s.title, first: s.first, mtime: r.mtime });
    if (out.length >= limit) break;
  }
  return out;
}
