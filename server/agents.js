// Agent packs (Claude Code subagent files) shipped in templates/agents/<pack>/.
// install() copies them into <project>/.claude/agents/ and NEVER overwrites:
// a file that already exists with the same name is skipped and reported.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATES = path.join(ROOT, 'templates', 'agents');
export const PACKS = ['yukjo', 'studio'];

export function packFiles(pack) {
  if (!PACKS.includes(pack)) throw new Error(`unknown pack: ${pack} (use ${PACKS.join(' | ')} | all)`);
  const dir = path.join(TEMPLATES, pack);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ({ name: f.slice(0, -3), file: f, src: path.join(dir, f) }));
}

export function expandPacks(pack) {
  if (!pack || pack === 'yukjo') return ['yukjo'];
  if (pack === 'all') return [...PACKS];
  if (Array.isArray(pack)) return pack.flatMap(expandPacks);
  return [String(pack)];
}

export function agentsDir(projectDir) {
  return path.join(path.resolve(projectDir), '.claude', 'agents');
}

// The `name:` in an agent file's frontmatter (falls back to the file name).
function agentName(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 4096);
    const m = /^---\s*\n([\s\S]*?)\n---/.exec(head);
    const n = m && /^name:\s*(.+)$/m.exec(m[1]);
    if (n) return n[1].trim().replace(/^["']|["']$/g, '');
  } catch {}
  return path.basename(file, '.md');
}

// What is already in <project>/.claude/agents, and which pack files are missing.
export function inspect(projectDir, pack = 'yukjo') {
  const dir = agentsDir(projectDir);
  const exists = fs.existsSync(dir);
  const present = exists ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
  const userAgents = present.map((f) => ({ file: f, name: agentName(path.join(dir, f)) }));
  const want = expandPacks(pack).flatMap(packFiles);
  const missing = want.filter((w) => !present.includes(w.file)).map((w) => w.name);
  const installed = want.filter((w) => present.includes(w.file)).map((w) => w.name);
  return { dir, exists, missing, installed, userAgents };
}

// -> { dir, copied: [name], skipped: [name] }
export function install(projectDir, pack = 'yukjo') {
  const target = path.resolve(projectDir);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error(`folder not found: ${target}`);
  const dir = agentsDir(target);
  fs.mkdirSync(dir, { recursive: true });
  const copied = [];
  const skipped = [];
  for (const p of expandPacks(pack)) {
    for (const f of packFiles(p)) {
      const dest = path.join(dir, f.file);
      try {
        // COPYFILE_EXCL: fails if dest exists, so an existing file is never replaced (no race either)
        fs.copyFileSync(f.src, dest, fs.constants.COPYFILE_EXCL);
        copied.push(f.name);
      } catch (e) {
        if (e.code === 'EEXIST') skipped.push(f.name);
        else throw e;
      }
    }
  }
  return { dir, copied, skipped };
}
