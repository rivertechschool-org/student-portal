#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Riven DURABLE UNDO round-trip.
//
// Undo is what makes Riven's writes safe to trust, and it used to die on
// refresh: the stack held CLOSURES, so a teacher who awarded RTC, reloaded, and
// said "undo" was told the list was empty — while the restored chat above still
// showed the write. Call sites may now pass an optional serializable SPEC; only
// those survive a reload, and a restored ("stale") entry CONFIRMS before running
// because the balance may have moved since.
//
// This exercises the whole cycle against the SHIPPED methods (brace-matched out
// of portal/index.html, same technique as the other harnesses): push -> persist
// -> drop memory -> restore -> run the rebuilt closures, plus the staleness
// cutoff and the corrupt/unknown-payload paths.
//
// Run:  node debug-tools/undo-durability.js
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const SRC_CANDIDATES = [
  path.join(__dirname, '..', 'portal', 'index.html'),
  path.join(__dirname, '..', 'student-portal', 'portal', 'index.html'),
  path.join(process.cwd(), 'portal', 'index.html'),
];
const SRC = process.argv[2] || SRC_CANDIDATES.find(p => fs.existsSync(p));
if (!SRC) { console.error('undo-durability: could not locate portal/index.html'); process.exit(2); }
const src = fs.readFileSync(SRC, 'utf8');


function bodyOf(name) {
  const re = new RegExp('\\n\\s+(?:async\\s+)?(?:get\\s+)?' + name + '\\s*\\(', 'g');
  const m = re.exec(src); if (!m) throw new Error('not found: ' + name);
  let p = src.indexOf('(', m.index), pd = 0;
  for (; p < src.length; p++) { if (src[p] === '(') pd++; else if (src[p] === ')') { pd--; if (!pd) { p++; break; } } }
  let i = src.indexOf('{', p), d = 0, start = i;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) { i++; break; } } }
  const sig = src.slice(m.index + 1, start).trim();
  return { args: sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')')), body: src.slice(start + 1, i - 1) };
}
const fn = (n) => { const b = bodyOf(n); return new Function(...b.args.split(',').map(s => s.trim()).filter(Boolean), b.body); };

// localStorage stub
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};

const calls = [];
const app = {
  userInfo: { profile: { id: 'teacher-1' } },
  _rtcTxn: async (o) => { calls.push(['rtc', o]); },
  auth: { supabase: { from: (t) => ({ delete: () => ({ eq: async (col, v) => { calls.push(['delete', t, v]); return { error: null }; } }) }) } },
};
for (const n of ['_rivenUndoKey', '_persistRivenUndo', '_restoreRivenUndo', '_pushUndo']) {
  const f = fn(n); app[n] = function (...a) { return f.apply(app, a); };
}
// the getter
const rev = fn('_rivenUndoReversers');
Object.defineProperty(app, '_rivenUndoReversers', { get: () => rev.apply(app) });

let pass = 0, fail = 0;
const check = (c, label) => { c ? (pass++, console.log('  ok   ' + label)) : (fail++, console.log('  FAIL ' + label)); };

// 1. a spec-less push stays session-only (unchanged legacy behaviour)
app._pushUndo('a legacy write', async () => { calls.push(['legacy']); });
check(localStorage.getItem('riven_undo_teacher-1') === null, 'spec-less push persists nothing');

// 2. RTC + note pushes with specs persist
app._pushUndo('+5 RTC for Ari Mercer', async () => {}, {
  kind: 'rtc', userId: 'id1', amount: -5, type: 'admin_adjustment',
  description: 'Undo of +5 RTC', refId: 'tx1', noteId: 'note9',
});
app._pushUndo('the note for Ari', async () => {}, { kind: 'note', noteId: 'note42' });
const raw = JSON.parse(localStorage.getItem('riven_undo_teacher-1'));
check(raw.length === 2, `persisted 2 durable entries (got ${raw.length})`);
check(!raw.some(e => e.desc === 'a legacy write'), 'legacy entry excluded from persistence');
check(raw.every(e => !('fn' in e)), 'closures are not serialized');

// 3. simulate a reload: wipe memory, restore
app._rivenUndoStack = [];
app._restoreRivenUndo();
check(app._rivenUndoStack.length === 2, `restored 2 entries (got ${app._rivenUndoStack.length})`);
check(app._rivenUndoStack.every(e => e.stale === true), 'restored entries are marked stale (will confirm)');
check(typeof app._rivenUndoStack[0].fn === 'function', 'closure rebuilt from spec');

// 4. the rebuilt closures do the right work
(async () => {
  await app._rivenUndoStack[1].fn();            // the note
  check(calls.some(c => c[0] === 'delete' && c[2] === 'note42'), 'note reverser deletes the right note');
  await app._rivenUndoStack[0].fn();            // the RTC award
  const rtc = calls.find(c => c[0] === 'rtc');
  check(rtc && rtc[1].amount === -5 && rtc[1].userId === 'id1', 'rtc reverser replays the reversing amount');
  check(calls.some(c => c[0] === 'delete' && c[2] === 'note9'), 'rtc reverser also removes the auto-note');

  // 5. entries older than a school day are dropped, not replayed
  store['riven_undo_teacher-1'] = JSON.stringify([
    { desc: 'yesterday', timestamp: Date.now() - 13 * 3600 * 1000, spec: { kind: 'note', noteId: 'old' } },
  ]);
  app._rivenUndoStack = [];
  app._restoreRivenUndo();
  check(app._rivenUndoStack.length === 0, 'entries older than 12h are dropped');

  // 6. unknown kinds and corrupt payloads never break the terminal
  store['riven_undo_teacher-1'] = JSON.stringify([{ desc: 'x', timestamp: Date.now(), spec: { kind: 'nope' } }]);
  app._rivenUndoStack = []; app._restoreRivenUndo();
  check(app._rivenUndoStack.length === 0, 'unknown spec kind ignored');
  store['riven_undo_teacher-1'] = '{{{not json';
  app._rivenUndoStack = [{ desc: 'live', fn: async () => {} }];
  app._restoreRivenUndo();
  check(app._rivenUndoStack.length === 1, 'corrupt payload leaves the live stack alone');

  console.log(`\n${fail ? 'FAIL' : 'PASS'} — ${pass} checks, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
