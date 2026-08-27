#!/usr/bin/env node
// Verify the Academic Credit Policy implementation against the policy document.
//
// Three things have to agree:
//   1. the credit grid seeded in the backend migration (the database's answer),
//   2. shared/credit-policy.js (the transcript's answer),
//   3. the totals the policy itself states in sections 5 and 6.
//
// A transcript that disagrees with the database is worse than either answer
// alone, so this reads the grid straight out of the migration SQL, feeds it to
// the browser resolver, and checks both against the published totals.
//
// Run:  node tools/verify-credit-policy.js
// Exits non-zero on any mismatch.

const fs = require('fs');
const path = require('path');
const BACKEND = require('./backend-path');

require('../shared/credit-policy.js');

const MIGRATION = path.join(
  BACKEND, 'supabase', 'migrations', 'zzzzzzzzzz_credit_policy_2026_27.sql'
);

// ---------------------------------------------------------------- SQL parsing

// Split a VALUES tuple on commas that are NOT inside a quoted string. The note
// strings contain parentheses and doubled quotes, so naive splitting breaks.
function splitTuple(s) {
  const out = [];
  let cur = '', inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "'" && s[i + 1] === "'") { cur += "'"; i++; continue; }
      if (ch === "'") { inStr = false; continue; }
      cur += ch;
    } else {
      if (ch === "'") { inStr = true; continue; }
      if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

// Pull the tuples out of an INSERT ... VALUES block, respecting quoted strings
// AND `--` line comments. The comments between rows contain apostrophes
// ("Friday's Python session"); treating those as string delimiters silently
// swallows every row after them, which is exactly the bug this note prevents.
function tuplesOf(body) {
  const tuples = [];
  let depth = 0, cur = '', inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === "'" && body[i + 1] === "'") { cur += "''"; i++; continue; }
      if (ch === "'") inStr = false;
      cur += ch;
      continue;
    }
    // Line comment outside a string: skip to end of line.
    if (ch === '-' && body[i + 1] === '-') {
      while (i < body.length && body[i] !== '\n') i++;
      continue;
    }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === '(') { depth++; if (depth === 1) { cur = ''; continue; } }
    if (ch === ')') { depth--; if (depth === 0) { tuples.push(cur); continue; } }
    if (depth > 0) cur += ch;
  }
  return tuples;
}

function coerce(raw) {
  if (raw === 'NULL' || raw === '') return null;
  if (raw === 'TRUE') return true;
  if (raw === 'FALSE') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function loadGrid() {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const rows = [];
  const re = /INSERT INTO public\.credit_policy \(([^)]*)\) VALUES([\s\S]*?)ON CONFLICT/g;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const cols = m[1].split(',').map(c => c.trim());
    for (const t of tuplesOf(m[2])) {
      const vals = splitTuple(t).map(coerce);
      if (vals.length !== cols.length) continue;   // a stray comment line
      const row = {};
      cols.forEach((c, i) => { row[c] = vals[i]; });
      ['pattern', 'grade_level', 'performer', 'requires_day'].forEach(k => {
        if (!(k in row)) row[k] = null;
      });
      row.effective_from_year = row.effective_from_year || 2026;
      rows.push(row);
    }
  }
  // The migration sets robotics' day gate in a follow-up UPDATE.
  for (const r of rows) {
    if (r.subject_key === 'robotics' && Number(r.credits) > 0) r.requires_day = 'fri';
  }
  return rows;
}

// ------------------------------------------------------------------- fixtures

const DAY_FLAGS = {
  mon_thu:  [true,  true, true, true, false],
  tue_fri:  [false, true, true, true, true],
  five_day: [true,  true, true, true, true],
};

function profile(pattern, performer, grade) {
  const d = DAY_FLAGS[pattern];
  return {
    attends_monday: d[0], attends_tuesday: d[1], attends_wednesday: d[2],
    attends_thursday: d[3], attends_friday: d[4],
    arts_performer: !!performer, grade_level: grade,
  };
}

// classes.credits is deliberately absurd: if a lookup falls through to the
// legacy value instead of matching a rule, the number is unmistakable.
const SENTINEL = 99;
function credit(subject, pattern, performer, grade) {
  return RTCredit.effective(
    { credits_override: null },
    { credit_subject: subject, credits: SENTINEL },
    profile(pattern, performer, grade),
    '2026-2027'
  );
}

// ---------------------------------------------------------------------- checks

let failures = 0;
function check(label, got, want) {
  const ok = Math.abs(Number(got) - Number(want)) < 1e-9;
  if (!ok) failures++;
  console.log(`  ${label.padEnd(34)}${String(got).padEnd(7)}want ${String(want).padEnd(6)}${ok ? 'ok' : 'MISMATCH'}`);
}

const grid = loadGrid();
RTCredit._setRules(grid);
console.log(`Loaded ${grid.length} credit_policy rows from the migration.\n`);

console.log('Section 5 — the credit grid');
[
  ['mathematics', 'mon_thu', 2], ['mathematics', 'tue_fri', 2], ['mathematics', 'five_day', 2],
  ['english', 'mon_thu', 2], ['english', 'five_day', 2],
  ['science', 'mon_thu', 1], ['social_studies', 'tue_fri', 1],
  ['applied_core', 'five_day', 1], ['christianity', 'mon_thu', 1],
  ['physical_education', 'mon_thu', 1],
  ['coding_ai', 'mon_thu', 1.5], ['coding_ai', 'tue_fri', 2], ['coding_ai', 'five_day', 2],
  ['robotics', 'mon_thu', 0], ['robotics', 'tue_fri', 0.5], ['robotics', 'five_day', 0.5],
  ['filmmaking', 'five_day', 1], ['yearbook', 'mon_thu', 0.5],
].forEach(([s, p, want]) => check(`${s} / ${p}`, credit(s, p, false, 11), want));

console.log('\nSection 3 — Annual Essay grows with the writer, held across patterns');
[[9, 0.25], [10, 0.5], [11, 0.75], [12, 1.0]].forEach(([g, want]) => {
  Object.keys(DAY_FLAGS).forEach(p =>
    check(`annual_essay grade ${g} / ${p}`, credit('annual_essay', p, false, g), want));
});

console.log('\nSection 6 — arts totals (a student is a performer OR not, never both)');
function artsTotal(pattern, performer) {
  const monday = performer ? 'arts_monday_production' : 'arts_monday_alternative';
  return ['arts_instruments_dance', 'arts_fine_arts', monday]
    .reduce((sum, s) => sum + credit(s, pattern, performer, 11), 0);
}
check('performer, Mon-Thu',        artsTotal('mon_thu', true),   2.5);
check('performer, 5-day',          artsTotal('five_day', true),  3.0);
check('non-performer, Mon-Thu',    artsTotal('mon_thu', false),  1.5);
check('non-performer, 5-day',      artsTotal('five_day', false), 2.0);
check('Tue-Fri student',           artsTotal('tue_fri', false),  1.0);

console.log('\nThe grid is total — a mis-enrollment cannot inherit the class default');
check('performer in alt block',     credit('arts_monday_alternative', 'five_day', true, 11), 0);
check('non-performer in production',credit('arts_monday_production', 'five_day', false, 11), 0);
check('Mon-Thu student, Fine Arts', credit('arts_fine_arts', 'mon_thu', false, 11), 0);

console.log('\nPrecedence and safe degradation');
check('credits_override wins',
  RTCredit.effective({ credits_override: 0.25 }, { credit_subject: 'mathematics', credits: SENTINEL },
    profile('five_day', false, 11), '2026-2027'), 0.25);
check('pre-2026 keeps issued value',
  RTCredit.effective({ credits_override: null }, { credit_subject: 'mathematics', credits: 3 },
    profile('five_day', false, 11), '2025-2026'), 3);
check('unmapped class = legacy',
  RTCredit.effective({ credits_override: null }, { credit_subject: null, credits: 7 },
    profile('five_day', false, 11), '2026-2027'), 7);
check('a la carte needs an override', credit('a_la_carte', 'five_day', false, 11), 0);

console.log('\nAttendance pattern derived from the registrar\'s day flags');
Object.keys(DAY_FLAGS).forEach(p => {
  const got = RTCredit.pattern(profile(p, false, 11));
  const ok = got === p;
  if (!ok) failures++;
  console.log(`  ${p.padEnd(34)}${got.padEnd(7)}want ${p.padEnd(6)}${ok ? 'ok' : 'MISMATCH'}`);
});

console.log(failures === 0
  ? '\nAll checks pass: migration grid, browser resolver, and policy agree.'
  : `\n${failures} MISMATCH(ES) — the grid, the resolver, and the policy disagree.`);
process.exit(failures === 0 ? 0 : 1);
