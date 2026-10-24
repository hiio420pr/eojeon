// 상소함: requests that are still waiting for the king — permission prompts not yet answered and
// questions Claude stopped on. Built from hook events, kept in ~/.eojeon/pending.json across restarts.
import fs from 'node:fs';
import path from 'node:path';

const MAX = 100;
// an answer that ends by asking something ("…할까요?", "Should I …?")
const ASKS = /[?？]\s*$|(까요|나요|ㄹ까요|습니까|하시겠어요|주세요)[.!…]?\s*$/;

export class Pending {
  constructor(file) {
    this.file = file;
    this.items = [];
    try {
      const v = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(v)) this.items = v.slice(-MAX);
    } catch {}
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.file, JSON.stringify(this.items), { mode: 0o600 });
    } catch {}
  }

  add(item) {
    if (this.items.some((x) => x.id === item.id)) return false;
    this.items.push(item);
    if (this.items.length > MAX) this.items.splice(0, this.items.length - MAX);
    return true;
  }

  drop(test) {
    const n = this.items.length;
    this.items = this.items.filter((x) => !test(x));
    return this.items.length !== n;
  }

  dismiss(id) {
    const changed = this.drop((x) => x.id === id);
    if (changed) this.save();
    return changed;
  }

  // returns true when the list changed
  apply(ev) {
    const s = ev.session || '';
    const base = { session: s, folder: ev.folder || '', agentType: ev.agentType || '', ext: !!ev.ext, time: ev.time || Date.now() };
    let changed = false;
    switch (ev.type) {
      case 'PermissionRequest':
        changed = this.add({ ...base, id: `perm:${s}:${ev.toolUseId || ev.time}`, kind: 'perm', tool: ev.tool || '', text: ev.summary || '' });
        break;
      case 'Notification':
        if (ev.kind === 'permission_prompt' && !this.items.some((x) => x.kind === 'perm' && x.session === s && base.time - x.time < 15000)) {
          changed = this.add({ ...base, id: `perm:${s}:${ev.time}`, kind: 'perm', tool: '', text: ev.message || '' });
        }
        break;
      case 'PreToolUse':
        if (ev.tool === 'AskUserQuestion') {
          changed = this.add({ ...base, id: `ask:${s}:${ev.toolUseId || ev.time}`, kind: 'ask', text: ev.summary || '질문이 있사옵니다' });
        }
        break;
      case 'PostToolUse':
      case 'PostToolUseFailure':
      case 'PermissionDenied':
        changed = this.drop((x) => x.session === s && (
          (ev.toolUseId && x.id.endsWith(`:${ev.toolUseId}`)) || (x.kind === 'perm' && (!x.tool || x.tool === ev.tool))
        ));
        break;
      case 'UserPromptSubmit':
        // the king spoke again in this session: everything it was waiting on has been answered or moved past
        changed = this.drop((x) => x.session === s);
        break;
      case 'Stop': {
        changed = this.drop((x) => x.session === s && x.kind === 'perm');
        const last = String(ev.answer || '').trim().split('\n').filter((l) => l.trim()).pop() || '';
        if (ASKS.test(last)) changed = this.add({ ...base, id: `ask:${s}:${ev.time}`, kind: 'ask', text: last.slice(0, 200) }) || changed;
        break;
      }
      case 'SessionEnd':
        changed = this.drop((x) => x.session === s && x.kind === 'perm');
        break;
      default:
        break;
    }
    if (changed) this.save();
    return changed;
  }
}
