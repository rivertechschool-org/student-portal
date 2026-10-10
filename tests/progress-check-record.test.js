// Math Dojo Progress Check: what the hosts save, and what they send back.
//
// A check arrives as DOJO_PROGRESS_CHECK. Both hosts - the student site
// (index.html) and the portal (portal/index.html, homework launches) - store
// it as a math_dojo_sessions row with mode 'progress_check', and answer
// DOJO_REQUEST_PROGRESS_HISTORY by turning those rows back into checks. The
// two copies must agree, or a check taken from homework would read
// differently from one taken on the student site.
//
// Run: node tests/progress-check-record.test.js

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`pass  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
};
const ok = (label, cond) => check(label, !!cond, true);

function method(file, name) {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const m = new RegExp('\\n\\s+async ' + name + '\\(([^)]*)\\) \\{').exec(html);
  if (!m) throw new Error(`${name} not found in ${file}`);
  let i = html.indexOf('{', m.index + m[0].length - 1), depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFn(...m[1].split(',').map(s => s.trim()), html.slice(start + 1, i));
}

// A stub table: insert records rows, select returns them newest first.
function stubDb() {
  const rows = [];
  const q = (filters = []) => ({
    select() { return q(filters); },
    eq(col, v) { return q(filters.concat([[col, v]])); },
    order() { return q(filters); },
    limit() {
      const hit = rows.filter(r => filters.every(([c, v]) => r[c] === v)).slice().reverse();
      return Promise.resolve({ data: hit.map(r => JSON.parse(JSON.stringify(r))), error: null });
    },
    insert(row) { rows.push({ ...JSON.parse(JSON.stringify(row)), created_at: '2026-10-05T10:00:00Z' }); return Promise.resolve({ error: null }); },
  });
  return { rows, from: () => q() };
}

const CHECK = {
  at: '2026-10-05T09:59:00.000Z', complete: true, reason: 'edge', duration_seconds: 412,
  items: [
    { code: '7', title: 'Percent Change', section: 'core', kind: 'frontier', correct: 2, total: 2, status: 'secure', skills: ['Percent Change'] },
    { code: '22', title: 'Slope', section: 'core', kind: 'frontier', correct: 1, total: 2, status: 'shaky', skills: ['Slope'] },
    { code: '31', title: 'Exponential Growth & Decay', section: 'core', correct: 0, total: 2, status: 'notyet', skills: ['Exponential Growth and Decay'] },
    { code: '33', title: 'Quadratic Relationships', section: 'core', correct: 0, total: 0, status: 'notseen', skills: ['Quadratic Equations'] },
    { code: '51', title: 'Quadratic Solving', section: 'core', correct: 0, total: 0, status: 'notreached', skills: ['Quadratic Formula'] },
  ],
  summary: { core_done: 15, core_total: 65, edge: { code: '31', title: 'Exponential Growth & Decay' }, secure: 1, shaky: 1, notyet: 1, notseen: 1, notreached: 1 },
};

(async () => {
  const hosts = [
    { name: 'student site', file: 'index.html',
      self: (db) => ({ portal: { auth: { supabase: db, isAuthenticated: () => true, getUserInfo: () => ({ profile: { id: 'p-ivy' } }) } } }) },
    { name: 'portal', file: 'portal/index.html',
      self: (db) => ({ auth: { supabase: db }, userInfo: { user: { id: 'a-ivy' }, profile: { id: 'p-ivy' } }, _progressStudentId() { return 'p-ivy'; } }) },
  ];
  const histories = [];
  for (const h of hosts) {
    console.log(`\n== ${h.name} ==\n`);
    const db = stubDb();
    const self = h.self(db);
    await method(h.file, 'saveDojoProgressCheck').call(self, { type: 'DOJO_PROGRESS_CHECK', subject: 'Math', check: CHECK });
    const row = db.rows[0];
    ok('saves one row', db.rows.length === 1);
    check('  as a progress check for the signed-in student', [row.mode, row.user_id, row.subject], ['progress_check', 'p-ivy', 'Math']);
    check('  totals', [row.skills_practiced, row.total_correct, row.total_questions, row.duration_seconds], [5, 3, 6, 412]);
    check('  one entry per item, each with a skill name for the activity views',
      row.skill_details.filter(d => d.kind === 'item').map(d => d.skill), ['Percent Change', 'Slope', 'Exponential Growth & Decay', 'Quadratic Relationships', 'Quadratic Solving']);
    check('  "not seen" and "not reached" are kept as they are',
      row.skill_details.filter(d => d.kind === 'item').map(d => d.status), ['secure', 'shaky', 'notyet', 'notseen', 'notreached']);
    ok('  and a summary entry with no skill, which those views skip',
      row.skill_details.some(d => d.kind === 'summary' && !d.skill && d.core_done === 15));

    let sent = null;
    const target = { postMessage: (m) => { sent = m; } };
    await method(h.file, 'sendDojoProgressHistory').call(self, target, { subject: 'Math' });
    ok('history is sent back', sent && sent.type === 'PROGRESS_HISTORY_FOR_DOJO');
    const back = sent.checks[0];
    check('  the check comes back as it was taken',
      [back.at, back.complete, back.reason, back.items.map(i => [i.code, i.status]), back.summary],
      [CHECK.at, true, 'edge', [['7', 'secure'], ['22', 'shaky'], ['31', 'notyet'], ['33', 'notseen'], ['51', 'notreached']],
       { core_done: 15, core_total: 65, edge: { code: '31', title: 'Exponential Growth & Decay' }, secure: 1, shaky: 1, notyet: 1, notseen: 1, notreached: 1 }]);
    histories.push(sent.checks);
  }

  console.log('\n== the two hosts agree ==\n');
  check('a check reads the same from either', histories[0], histories[1]);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
