#!/usr/bin/env python3
# Daily attendance: marking a student absent, then excused, opens the excuse
# note under them - without reloading.
#
# Reported 2026-10-05: the note row's visibility was decided only when the
# roster was drawn, and ticking Excused just saved, so the note field did not
# appear until the whole page was refreshed. Covered here, on the real roster
# with the database stubbed (two invented students, every write recorded):
#   * absent -> excused shows the note, and the cursor lands in it
#   * the note typed there is what gets saved
#   * unticking hides it again
#   * switching away from Absent hides it; back to Absent (still ticked)
#     brings it back
#   * an excuse marked on another device appears on the next refresh
#
# Run:  python -m http.server 8792 &   (repo root)
#       python debug-tools/daily-attendance-excused-journey.py
import os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('SITE_URL', 'http://localhost:8792')
CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fails = 0
def ok(label, cond, extra=''):
    global fails
    print(('  ok   ' if cond else '  FAIL ') + label + (f'  [{extra}]' if extra else ''))
    fails += (0 if cond else 1)

STUB = r"""() => {
  window.__writes = [];
  window.__remote = [];
  const tables = {
    student_schedule: [{ student_id: 's-ada' }, { student_id: 's-bo' }],
    user_profiles: [
      { id: 's-ada', first_name: 'Ada', last_name: 'Quill', grade_level: '7', enrollment_type: 'full_time' },
      { id: 's-bo', first_name: 'Bo', last_name: 'Wren', grade_level: '8', enrollment_type: 'full_time' },
    ],
  };
  const builder = (table) => {
    const b = {
      _upsert: null,
      then(res, rej) {
        if (b._upsert) { window.__writes.push(...b._upsert); return Promise.resolve({ data: null, error: null }).then(res, rej); }
        const data = table === 'daily_attendance' ? window.__remote.map(r => ({ ...r })) : (tables[table] || []).map(r => ({ ...r }));
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
      upsert(rows) { b._upsert = rows.map(r => ({ ...r })); return b; },
      single() { return Promise.resolve({ data: null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    };
    return new Proxy(b, { get: (t, k) => k in t ? t[k] : () => new Proxy(b, { get: (t2, k2) => (k2 in t2 ? t2[k2] : (() => this)) }) });
  };
  // Every query-building method returns the same thenable builder.
  const chain = (table) => {
    const b = builder(table);
    const p = new Proxy({}, { get: (_, k) => {
      if (k === 'then') return b.then;
      if (k === 'upsert') return (rows) => { b.upsert(rows); return p; };
      if (k === 'single' || k === 'maybeSingle') return b[k];
      return () => p;
    }});
    return p;
  };
  app.auth = app.auth || {};
  app.auth.supabase = { from: chain, rpc: () => Promise.resolve({ data: null, error: null }) };
  app.userInfo = { user: { id: 'u-teacher' }, profile: { user_type: 'teacher' }, isAuthenticated: true, hasProfile: true };
  app.sendAttendanceAlertNotifications = () => {};
  app.applyPlannedAbsences = async () => 0;
  app._loadStudentGroupIndex = async () => ({ groups: [], byStudent: {} });
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)
    pg = b.new_page(viewport={'width': 1280, 'height': 900})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'{BASE}/portal/index.html')
    pg.wait_for_function("window.app && typeof app.showDailyAttendanceRoster === 'function'", timeout=30000)
    pg.evaluate(STUB)
    pg.evaluate("app.showDailyAttendanceRoster('2026-10-05')")
    pg.wait_for_selector('.attendance-status[data-student-id="s-ada"]', timeout=10000)

    note_row = '.excuse-note-row[data-student-id="s-ada"]'
    visible = lambda sel: pg.evaluate(f"(() => {{ const el = document.querySelector('{sel}'); return !!el && getComputedStyle(el).display !== 'none'; }})()")

    print('\n== absent, then excused ==')
    pg.select_option('.attendance-status[data-student-id="s-ada"]', 'absent'); pg.wait_for_timeout(200)
    ok('Excused box appears for an absent student', visible('.excused-section[data-student-id="s-ada"]'))
    ok('no note yet', not visible(note_row))
    pg.check('.excused-checkbox[data-student-id="s-ada"]'); pg.wait_for_timeout(200)
    ok('ticking Excused shows the note row, no reload', visible(note_row))
    ok('and the cursor is in the note', pg.evaluate("document.activeElement?.classList.contains('excuse-note')"))
    pg.keyboard.type('Dentist appointment'); pg.wait_for_timeout(1200)
    last = [w for w in pg.evaluate("window.__writes") if w['student_id'] == 's-ada'][-1]
    ok('the note is saved with the excuse', last.get('excused') is True and last.get('excuse_note') == 'Dentist appointment', last)

    print('\n== untick, and status changes ==')
    pg.uncheck('.excused-checkbox[data-student-id="s-ada"]'); pg.wait_for_timeout(200)
    ok('unticking hides the note', not visible(note_row))
    pg.check('.excused-checkbox[data-student-id="s-ada"]'); pg.wait_for_timeout(200)
    pg.select_option('.attendance-status[data-student-id="s-ada"]', 'present'); pg.wait_for_timeout(200)
    ok('switching to Present hides the note', not visible(note_row))
    pg.select_option('.attendance-status[data-student-id="s-ada"]', 'absent'); pg.wait_for_timeout(200)
    ok('back to Absent, still ticked, brings the note back', visible(note_row))

    print('\n== marked on another device ==')
    pg.evaluate("document.activeElement && document.activeElement.blur(); app._dailyPending && app._dailyPending.clear()")
    pg.evaluate("window.__remote = [{ student_id: 's-bo', date: '2026-10-05', status: 'absent', excused: true, excuse_note: 'Family trip' }]")
    pg.evaluate("app.refreshDailyAttendance()"); pg.wait_for_timeout(400)
    ok("another device's excuse shows the note row", visible('.excuse-note-row[data-student-id="s-bo"]'))
    ok('with its note filled in', pg.evaluate("document.querySelector('.excuse-note[data-student-id=\"s-bo\"]').value") == 'Family trip')

    ok('no page errors', not errs, errs[:3])
    b.close()
print('FAILS:', fails); sys.exit(1 if fails else 0)
