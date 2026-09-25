// One gate for the deletes that cannot be undone.
//
// There were five, written five times, and they disagreed with each other:
//
//   enrolment (two paths)   confirm -> confirm -> type DELETE
//                           confirm -> type DELETE
//   user account            confirm -> confirm -> type DELETE
//   an entire CLASS         confirm -> confirm            <- no typing at all
//
// So deleting a class -- every assignment, submission, grade, enrolment and
// attendance record in it -- was the EASIEST of the five to do by accident,
// and deleting a single enrolment was the hardest. That is exactly backwards,
// and it is what five hand-written copies of one idea produces.
//
// The gate is two steps now, always: say exactly what goes, then make them
// type it. The old middle box ("are you absolutely sure? type DELETE next")
// is gone -- the prompt says that itself, and a confirm nobody reads is not a
// gate, it is a keystroke.
//
// Run: node tests/confirm-destructive.test.js

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

function lift(name) {
  const re = new RegExp('\\n {2,8}(?:async )?' + name + '\\s*\\(([^)]*)\\)\\s*\\{');
  const m = re.exec(html);
  if (!m) throw new Error(name + ' not found');
  let i = html.indexOf('{', m.index + m[0].length - 1), depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  // The real signature, defaults and all: rebuilding it as
  // ('summary', 'losses') silently drops `losses = []` and tests a
  // function the app does not have.
  return new Function(m[1], html.slice(start + 1, i - 1));
}

function harness({ confirmAnswer = true, typed = 'DELETE' } = {}) {
  const seen = { confirms: [], prompts: [], notices: [] };
  global.confirm = (msg) => { seen.confirms.push(msg); return confirmAnswer; };
  global.prompt = (msg) => { seen.prompts.push(msg); return typed; };
  const app = { showNotification: (m, k) => seen.notices.push(`${k}:${m}`) };
  app.confirmDestructive = lift('confirmDestructive');
  return { app, seen };
}

(async () => {

  console.log('\n== the gate itself ==\n');

  {
    const { app, seen } = harness();
    const go = app.confirmDestructive.call(app, 'Permanently delete the class "Chess"?',
      ['All assignments', 'All attendance records']);
    check('a full pass lets it through', go, true);
    check('  exactly one box, not two', seen.confirms.length, 1);
    check('  then exactly one typed confirmation', seen.prompts.length, 1);
    ok('  the box names what goes', /All assignments/.test(seen.confirms[0])
       && /All attendance records/.test(seen.confirms[0]));
    ok('  and says it is final', /CANNOT be undone/i.test(seen.confirms[0]));
    ok('  the prompt repeats WHAT is being deleted, not just "type DELETE"',
       /Chess/.test(seen.prompts[0]));
  }

  {
    const { app, seen } = harness({ confirmAnswer: false });
    check('backing out of the box stops it', app.confirmDestructive.call(app, 'x', []), false);
    check('  and it never asks them to type anything', seen.prompts.length, 0);
    check('  and stays quiet, because nothing happened', seen.notices, []);
  }

  {
    const { app, seen } = harness({ typed: 'delete' });
    check('lower case is not the word', app.confirmDestructive.call(app, 'x', []), false);
    ok('  and it says it was cancelled', seen.notices.some(n => /cancelled/i.test(n)));
  }

  for (const typed of ['', null, 'DELETE ', 'Delete', 'yes']) {
    const { app } = harness({ typed });
    check(`typing ${JSON.stringify(typed)} does not delete`,
          app.confirmDestructive.call(app, 'x', []), false);
  }

  {
    const { app, seen } = harness();
    app.confirmDestructive.call(app, 'Delete it?');   // losses omitted
    ok('it works with nothing to list', /Delete it\?/.test(seen.confirms[0]));
    ok('  and does not print an empty list header',
       !/This will delete:/.test(seen.confirms[0]));
  }

  console.log('\n== every hard delete goes through it ==\n');

  // The five that used to hand-roll their own gate.
  for (const [fn, what] of [
    ['permanentlyDeleteEnrollment', 'an enrolment'],
    ['hardDeleteUserAccount', 'a whole account'],
  ]) {
    const i = html.search(new RegExp('\\n {2,8}(?:async )?' + fn + '\\s*\\('));
    const body = html.slice(i, i + 1400);
    ok(`${fn} (${what}) uses the shared gate`, /this\.confirmDestructive\(/.test(body));
    ok(`  and no longer rolls its own`, !/prompt\('Type DELETE/.test(body));
  }

  {
    // THE one that was wrong: deleting a class asked twice and never made
    // anybody type anything.
    const i = html.indexOf('PERMANENT DELETION');
    const around = i >= 0 ? html.slice(Math.max(0, i - 1200), i + 400) : '';
    const classDel = html.slice(html.indexOf('hard_delete_class') - 1400,
                                html.indexOf('hard_delete_class'));
    ok('deleting a class now requires typing DELETE',
       /if \(!this\.confirmDestructive\(/.test(classDel));
    ok('  and lists what goes with it',
       /All student submissions and grades/.test(classDel));
    // Presence is not enough: a plain confirm left in front of it, or the
    // helper disabled behind an `if (false &&`, both read as "present".
    ok('  and nothing else gates it first',
       !/if \(!confirm\(/.test(classDel));
    ok('  and the helper is not switched off',
       !/if \(false/.test(classDel));
  }

  {
    // No survivors: the old shape must be gone everywhere, or the
    // inconsistency is back with one straggler.
    // Single-quoted only: the helper's own prompt uses a backtick, and
    // counting it would keep this permanently red for the one prompt
    // that is supposed to exist.
    const strays = (html.match(/prompt\(\s*'Type ["']?DELETE/g) || []).length;
    check('no hand-rolled "type DELETE" prompts remain', strays, 0);
    check('  and none spelled the other way either',
          (html.match(/Type \"DELETE\" to confirm deletion/g) || []).length, 0);
    const doubles = (html.match(/Type ["']DELETE["'] in the next prompt/g) || []).length;
    check('and no "type DELETE next" middle boxes remain', doubles, 0);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
