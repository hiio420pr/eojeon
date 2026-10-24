// node-pty 1.x prebuilds on macOS ship spawn-helper without the exec bit
// ("posix_spawnp failed"). Restore it after install. Safe to run repeatedly.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
for (const mod of ['node-pty', '@homebridge/node-pty-prebuilt-multiarch']) try {
  const root = path.dirname(require.resolve(`${mod}/package.json`));
  for (const dir of ['prebuilds', 'build/Release']) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name === 'spawn-helper') fs.chmodSync(p, 0o755);
      }
    };
    walk(base);
  }
} catch (e) {
  // optional dependency not installed on this platform: nothing to fix
  if (e.code !== 'MODULE_NOT_FOUND') console.warn(`[eojeon] could not fix ${mod} spawn-helper:`, e.message);
}
