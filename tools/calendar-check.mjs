// Is the school calendar actually populated?
//
// The calendar on the portal home page is not one table - it stitches together
// seven sources, and any of them can be empty on its own while the rest look
// fine. This reports each separately so "the calendar is empty" turns into
// "school_events has nothing after October".
//
// Every source the calendar reads is RLS-gated to `authenticated`, so this has
// to sign in as a real user. It signs in as YOU, using credentials from the
// environment, and only ever issues SELECTs. Nothing is created, changed or
// deleted, and no student names are printed - only counts, dates and event
// titles, which is what answering the question needs.
//
//   set PORTAL_EMAIL=you@school.org
//   set PORTAL_PASSWORD=...            (your normal portal login)
//
// Run:
//   node tools/calendar-check.mjs                 # this month + next 5
//   node tools/calendar-check.mjs --months 12
//   node tools/calendar-check.mjs --from 2026-08-01 --to 2027-06-30
//   node tools/calendar-check.mjs --list          # show the events themselves

const SUPABASE_URL = 'https://joxvhzxkrcigknsdrusr.supabase.co';
// The publishable key, identical to the one the site ships to every visitor.
// It grants nothing on its own - RLS decides everything - so it is not a secret.
const SUPABASE_KEY = 'sb_publishable_xgvdFBaHCJKl9p-Lu61aZw_3oLkeTtc';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(name);

const email = process.env.PORTAL_EMAIL;
const password = process.env.PORTAL_PASSWORD;
if (!email || !password) {
  console.error('Set PORTAL_EMAIL and PORTAL_PASSWORD first.\n' +
    '  PowerShell, this session only:\n' +
    '    $env:PORTAL_EMAIL = "you@school.org"\n' +
    '    $env:PORTAL_PASSWORD = Read-Host "portal password" -AsSecureString | ForEach-Object {\n' +
    '      [Runtime.InteropServices.Marshal]::PtrToStringAuto(\n' +
    '        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) }\n' +
    '  Nothing is stored; close the terminal and it is gone.');
  process.exit(2);
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The school year, not the calendar year: default to this month and the five
// after it, which is the window someone asking "is it populated" cares about.
let from = flag('--from');
let to = flag('--to');
if (!from || !to) {
  const months = Number(flag('--months', 6));
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + months, 0);
  from = from || iso(start);
  to = to || iso(end);
}

async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // Never echo the password or the raw body, which can contain the payload.
    throw new Error(`Sign-in failed (${res.status}): ${body.error_description || body.msg || 'check PORTAL_EMAIL / PORTAL_PASSWORD'}`);
  }
  return body.access_token;
}

async function select(token, table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: `${res.status} ${detail.slice(0, 160)}` };
  }
  return { rows: await res.json() };
}

const byMonth = (rows, field) => {
  const out = {};
  for (const r of rows) {
    const key = String(r[field] || '').slice(0, 7);
    if (key) out[key] = (out[key] || 0) + 1;
  }
  return out;
};

const monthLine = (counts) => {
  const keys = Object.keys(counts).sort();
  if (!keys.length) return '    (none in range)';
  return '    ' + keys.map((k) => `${k}:${counts[k]}`).join('  ');
};

(async () => {
  console.log(`School calendar check   ${from} -> ${to}`);
  console.log('='.repeat(64));

  let token;
  try {
    token = await signIn();
  } catch (e) {
    console.error(String(e.message));
    // exitCode, not exit(): killing the process while a fetch handle is still
    // open trips a libuv assertion on Windows and buries the real message
    // under a crash dump.
    process.exitCode = 1;
    return;
  }

  const sources = [
    { key: 'school_events', label: 'School Events', table: 'school_events',
      query: `select=id,title,event_type,start_date,end_date&start_date=lte.${to}&or=(end_date.gte.${from},and(end_date.is.null,start_date.gte.${from}))&order=start_date`,
      dateField: 'start_date' },
    { key: 'quarters', label: 'Quarters', table: 'quarters',
      query: 'select=name,start_date,end_date&order=start_date', dateField: 'start_date' },
    { key: 'assignments', label: 'Assignments', table: 'assignments',
      query: `select=id,due_date&due_date=gte.${from}&due_date=lte.${to}`, dateField: 'due_date' },
    { key: 'class_schedule', label: 'Class schedule', table: 'class_schedule',
      query: 'select=id,day_of_week,period', dateField: null },
    { key: 'facility_bookings', label: 'Room bookings', table: 'facility_bookings',
      query: `select=id,booking_date&booking_date=gte.${from}&booking_date=lte.${to}`, dateField: 'booking_date' },
  ];

  const summary = {};
  for (const s of sources) {
    const { rows, error } = await select(token, s.table, s.query);
    if (error) {
      console.log(`\n  ${s.label.padEnd(16)} ERROR  ${error}`);
      summary[s.key] = -1;
      continue;
    }
    summary[s.key] = rows.length;
    console.log(`\n  ${s.label.padEnd(16)} ${rows.length} row(s)`);
    if (s.dateField && rows.length) console.log(monthLine(byMonth(rows, s.dateField)));

    if (s.key === 'quarters' && rows.length) {
      for (const q of rows) console.log(`    ${q.name}: ${q.start_date} -> ${q.end_date}`);
    }
    if (s.key === 'school_events' && rows.length && has('--list')) {
      for (const e of rows) {
        const span = e.end_date && e.end_date !== e.start_date ? ` -> ${e.end_date}` : '';
        console.log(`    ${e.start_date}${span}  [${e.event_type}]  ${e.title}`);
      }
    }
    if (s.key === 'class_schedule' && rows.length) {
      const days = new Set(rows.map((r) => r.day_of_week));
      console.log(`    covers ${days.size} day(s) of the week: ${[...days].sort().join(', ')}`);
    }
  }

  console.log('\n' + '='.repeat(64));
  // The calendar renders per month, so the honest verdict is per source, not
  // one number - a full assignment list still leaves the calendar looking bare
  // if nobody has entered a single holiday.
  const verdict = [];
  if (summary.school_events === 0) verdict.push('school_events is EMPTY for this range - no holidays, closures or events will show');
  if (summary.quarters === 0) verdict.push('quarters is EMPTY - no quarter boundaries, and grading periods depend on this too');
  if (summary.class_schedule === 0) verdict.push('class_schedule is EMPTY - the recurring class layer will be blank every week');
  if (!verdict.length) console.log('Every calendar source has rows in this range.');
  else verdict.forEach((v) => console.log('  ! ' + v));
})();
