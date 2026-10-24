#!/usr/bin/env node
// Pre-publish guard: lists what `npm pack` would ship and fails if any file
// leaks a local path, an e-mail address or a token-shaped string.
// Runs from prepublishOnly; also `npm run check-publish`.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const out = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
const [info] = JSON.parse(out);
const files = info.files.map((f) => f.path).sort();

// Every shipped file must be under one of these (README/LICENSE/package.json are added by npm itself).
const ALLOWED = [/^bin\//, /^server\//, /^public\//, /^templates\/agents\/(yukjo|studio)\/[a-z-]+\.md$/, /^scripts\/fix-pty\.js$/,
  /^court\.config\.json$/, /^CHANGELOG\.md$/, /^README\.md$/, /^LICENSE$/, /^package\.json$/];
const MUST = ['cli/eojeon.js', 'server/index.js', 'server/hook.js', 'server/agents.js', 'public/index.html',
  'public/fonts/LICENSE-Galmuri.txt', 'public/fonts/LICENSE-D2Coding.txt', 'templates/agents/yukjo/ijo.md', 'court.config.json', 'LICENSE'];

const LEAKS = [
  ['local path /Users/', /\/Users\/[A-Za-z0-9._-]+/],
  ['local path /Volumes/', /\/Volumes\/[A-Za-z0-9._-]+/],
  ['local path /home/<user>', /\/home\/(?!runner\b)[a-z][a-z0-9_-]+\//],
  ['Windows user path', /[A-Za-z]:\\Users\\[^\\\s]+/],
  ['e-mail address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['Anthropic/OpenAI key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['AWS key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{20,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
// Font license files carry the font authors' contact e-mail; that is required by the OFL.
const EMAIL_OK = new Set(['public/fonts/LICENSE-Galmuri.txt', 'public/fonts/LICENSE-D2Coding.txt']);
const BINARY = /\.(woff2?|ttf|png|ico)$/;

const problems = [];
for (const f of files) {
  if (!ALLOWED.some((re) => re.test(f))) problems.push(`${f}: not in the publish whitelist`);
  if (BINARY.test(f)) continue;
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const [label, re] of LEAKS) {
    if (label === 'e-mail address' && EMAIL_OK.has(f)) continue;
    const m = re.exec(text);
    if (m) problems.push(`${f}: ${label} → "${m[0].slice(0, 12)}…"`);
  }
}
for (const f of MUST) if (!files.includes(f)) problems.push(`${f}: missing from the package`);

console.log(`npm pack --dry-run: ${info.name}@${info.version} · ${files.length} files · ${(info.size / 1024).toFixed(0)} kB packed · ${(info.unpackedSize / 1024).toFixed(0)} kB unpacked`);
for (const f of files) console.log(`  ${f}`);
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\n✓ no local paths, e-mails or tokens in the package');
