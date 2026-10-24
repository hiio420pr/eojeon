// Turns a raw Claude Code hook payload into a small, display-safe event.
// Runs inside the hook process, so only the trimmed result ever leaves Claude Code
// (and even then only to 127.0.0.1). No file contents, no tool output, no full prompts.

import path from 'node:path';
import os from 'node:os';

const MAX = 72;

// [pattern, replacement]. Order matters: specific token shapes first, generic KEY=value last.
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '***'],
  [/sk-[A-Za-z0-9_-]{12,}/g, '***'], // Anthropic / OpenAI style keys
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, '***'], // GitHub tokens
  [/github_pat_[A-Za-z0-9_]{20,}/g, '***'],
  [/xox[abprs]-[A-Za-z0-9-]{10,}/g, '***'], // Slack
  [/AKIA[0-9A-Z]{16}/g, '***'], // AWS access key id
  [/AIza[0-9A-Za-z_-]{30,}/g, '***'], // Google API key
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '***'], // JWT
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***'],
  [/(:\/\/)[^\s/:@]+:[^\s/@]+@/g, '$1***@'], // user:pass@host
  // API_KEY=value, token: value, --password value ...
  [/\b([A-Za-z0-9_-]*(?:key|token|secret|passw(?:or)?d|pwd|auth|cookie|credential)[A-Za-z0-9_]*)(\s*[=:]\s*|\s+)("[^"]*"|'[^']*'|[^\s"'&;|]+)/gi, '$1$2***'],
];

export function redact(s) {
  if (typeof s !== 'string') return '';
  let out = s;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

export function clip(s, n = MAX) {
  if (typeof s !== 'string') return '';
  const one = s.replace(/\s+/g, ' ').trim();
  const chars = [...one];
  return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : one;
}

const HOME = os.homedir();

export function shortPath(p, cwd) {
  if (typeof p !== 'string' || !p) return '';
  let out = p;
  if (cwd && (p === cwd || p.startsWith(cwd + path.sep))) out = path.relative(cwd, p) || '.';
  else if (HOME && p.startsWith(HOME + path.sep)) out = '~' + p.slice(HOME.length);
  if (out.length > 48) {
    const parts = out.split(path.sep);
    out = parts.length > 2 ? `${parts[0]}/…/${parts.slice(-2).join('/')}` : '…' + out.slice(-46);
  }
  return out;
}

function host(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
}

// One short line describing what a tool is doing, e.g. "npm test" or "App/Views/Home.swift".
export function toolSummary(tool, input, cwd) {
  const i = input && typeof input === 'object' ? input : {};
  const fp = i.file_path || i.notebook_path || i.path;
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return clip(redact(String(i.command || '').split('\n')[0]), 56);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return shortPath(fp, cwd);
    case 'Grep':
      return clip(redact(String(i.pattern || '')), 40) + (i.path ? ` · ${shortPath(i.path, cwd)}` : '');
    case 'Glob':
      return clip(String(i.pattern || ''), 48);
    case 'WebFetch':
      return host(i.url);
    case 'WebSearch':
      return clip(redact(String(i.query || '')), 48);
    case 'Task':
    case 'Agent':
      return clip([i.subagent_type, i.description].filter(Boolean).join(' · '), 56);
    case 'TodoWrite':
      return Array.isArray(i.todos) ? `할 일 ${i.todos.length}개` : '';
    case 'Skill':
      return clip(String(i.skill || i.command || ''), 40);
    default:
      if (typeof tool === 'string' && tool.startsWith('mcp__')) return tool.split('__').slice(1).join(' · ');
      return fp ? shortPath(fp, cwd) : '';
  }
}

function toolLabel(tool) {
  if (typeof tool !== 'string') return '';
  if (tool.startsWith('mcp__')) return 'MCP';
  return tool.slice(0, 32);
}

// raw hook stdin JSON -> display event
export function sanitize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const cwd = typeof r.cwd === 'string' ? r.cwd : '';
  const ev = {
    type: String(r.hook_event_name || 'Unknown').slice(0, 40),
    time: Date.now(),
    session: typeof r.session_id === 'string' ? r.session_id.slice(0, 36) : '',
  };
  if (cwd) ev.folder = path.basename(cwd);
  if (r.agent_id) ev.agentId = String(r.agent_id).slice(0, 64);
  if (r.agent_type) ev.agentType = String(r.agent_type).slice(0, 64);
  if (r.permission_mode) ev.mode = String(r.permission_mode).slice(0, 24);

  switch (ev.type) {
    case 'SessionStart':
      ev.source = String(r.source || 'startup').slice(0, 16);
      if (r.model) ev.model = String(r.model).slice(0, 48);
      break;
    case 'UserPromptSubmit':
      // Only a short, redacted preview of the prompt (the "royal decree").
      ev.prompt = clip(redact(String(r.prompt || '')), 60);
      ev.slash = /^\s*\//.test(String(r.prompt || ''));
      break;
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionRequest':
    case 'PermissionDenied':
      ev.tool = toolLabel(r.tool_name);
      ev.summary = toolSummary(r.tool_name, r.tool_input, cwd);
      if (r.tool_use_id) ev.toolUseId = String(r.tool_use_id).slice(0, 64);
      if ((r.tool_name === 'Task' || r.tool_name === 'Agent') && r.tool_input && r.tool_input.subagent_type) {
        ev.spawnType = String(r.tool_input.subagent_type).slice(0, 64);
      }
      if (ev.type === 'PostToolUse' && typeof r.duration_ms === 'number') ev.ms = r.duration_ms;
      break;
    case 'Notification':
      ev.kind = String(r.notification_type || '').slice(0, 40);
      ev.message = clip(redact(String(r.message || '')), 80);
      break;
    case 'SubagentStop':
      // A one-line taste of the report, nothing more.
      ev.report = clip(redact(String(r.last_assistant_message || '')), 48);
      break;
    case 'SessionEnd':
      if (r.reason) ev.reason = String(r.reason).slice(0, 24);
      break;
    default:
      break;
  }
  return ev;
}
