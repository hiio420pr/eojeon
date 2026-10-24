// Pure helpers (no DOM) shared by the browser and the tests:
// map a Claude Code agent_type to an entry in court.config.json.

// Plugin agents arrive namespaced, e.g. "eojeon:ijo" or "my-plugin:review:security".
// Exact keys win; otherwise the part after the last colon is tried.
export function resolveAgentType(type, cfg) {
  const t = typeof type === 'string' ? type : '';
  const team = (cfg && cfg.officials) || {};
  const guests = (cfg && cfg.guests) || {};
  const has = (k) => k && !k.startsWith('_') && (Object.hasOwn(team, k) || Object.hasOwn(guests, k));
  if (has(t)) return t;
  if (t.includes(':')) {
    const tail = t.slice(t.lastIndexOf(':') + 1);
    if (has(tail)) return tail;
  }
  return t;
}

// -> { key, def, kind: 'main' | 'seat' | 'guest' | 'unknown' }
export function lookupOfficial(type, cfg) {
  const team = (cfg && cfg.officials) || {};
  const guests = (cfg && cfg.guests) || {};
  if (!type) return { key: 'main', def: team.main, kind: 'main' };
  const key = resolveAgentType(type, cfg);
  if (key !== 'main' && Object.hasOwn(team, key) && !key.startsWith('_')) return { key, def: team[key], kind: 'seat' };
  if (Object.hasOwn(guests, key) && key !== '*') return { key, def: guests[key], kind: 'guest' };
  const any = guests['*'] || { title: '관리', role: '맡은 일을 한다', robe: 'nok' };
  return { key, def: { ...any, title: `${any.title} · ${type}` }, kind: 'unknown' };
}

export function titleOf(type, cfg) {
  return lookupOfficial(type, cfg).def?.title || String(type || '');
}
