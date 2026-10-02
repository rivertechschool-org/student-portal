#!/usr/bin/env python3
# "No grades yet" on the teacher's side, and "Submitted late" for parents.
#
# Manage Grades drew a student with nothing graded as "0.0 (F)" in three
# places, and "Use This" would have saved that F as the final grade. The staff
# "Grades for <student>" view said "Overall: 0%". The parent assignment list
# never showed late work. This renders each in Chrome with invented people.
#
# Run:  python -m http.server 8787 &   (repo root)
#       python debug-tools/grades-no-work-journey.py
import os, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get('PORTAL_URL', 'http://localhost:8787/portal/index.html')
CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fails = 0
def ok(label, cond, extra=''):
    global fails
    print(('  ok   ' if cond else '  FAIL ') + label + (f'  [{extra}]' if extra else ''))
    fails += (0 if cond else 1)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)
    pg = b.new_page(viewport={'width': 1300, 'height': 900})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_function("window.app && window.teacherGrades", timeout=30000)
    pg.wait_for_timeout(800)

    # ---- Manage Grades ----
    pg.evaluate("""() => {
      document.body.insertAdjacentHTML('beforeend', '<div id="grade-modal-content"></div>');
      const tg = window.teacherGrades;
      tg.currentClassGradingWeight = 'even';
      tg.pendingChanges = {};
      tg.enrollments = [
        { id: 'e1', user_profiles: { first_name: 'Nell', last_name: 'Nothingyet', email: 'n@x.test' },
          academic_grade: 0, assignment_count: 0, participation_grade: null, suggested_class_grade: 0, class_grade: 0 },
        { id: 'e2', user_profiles: { first_name: 'Gus', last_name: 'Graded', email: 'g@x.test' },
          academic_grade: 88.5, assignment_count: 6, participation_grade: 90, suggested_class_grade: 89.2, class_grade: 89.2 },
        { id: 'e3', user_profiles: { first_name: 'Tia', last_name: 'Teacherset', email: 't@x.test' },
          academic_grade: 0, assignment_count: 0, participation_grade: null, class_grade: 75, class_grade_override: true },
      ];
      tg.renderGradeTable();
    }""")
    row = lambda id: pg.locator(f'tr[data-enrollment-id="{id}"]')
    r1 = row('e1').inner_text()
    ok('no graded work: says so, no F', 'No grades yet' in r1 and 'NO GRADED WORK YET' in r1 and ' F' not in r1.replace('A–F', ''), r1.replace('\n', ' | ')[:160])
    ok('  the boxes are blank, not 0.0', pg.locator('tr[data-enrollment-id="e1"] .final-grade-input').input_value() == ''
       and pg.locator('tr[data-enrollment-id="e1"] .academic-grade-input').input_value() == '')
    ok('  and "Use This" is hidden', not row('e1').locator('button', has_text='Use This').is_visible())
    pg.evaluate("window.teacherGrades.useSuggestedGrade('e1', null)")
    ok('  and cannot save an F if called anyway', 'e1' not in pg.evaluate("Object.keys(window.teacherGrades.pendingChanges)"))
    r2 = row('e2').inner_text()
    ok('graded student unchanged', '89.2' in r2 and 'Use This' in r2, r2.replace('\n', ' | ')[:120])
    r3 = row('e3')
    ok('a teacher-set grade still shows', r3.locator('.final-grade-input').input_value() == '75.0' and 'TEACHER SET' in r3.inner_text())

    # ---- staff "Grades for <student>" ----
    def stub(subs, enr):
        pg.evaluate("""([subs, enr]) => {
          const api = (rows) => { const a = { select() { return a; }, eq() { return a; }, order() { return a; }, in() { return a; }, limit() { return a; },
            single() { return Promise.resolve({ data: enr, error: null }); },
            maybeSingle() { return Promise.resolve({ data: enr, error: null }); },
            then(r) { return Promise.resolve({ data: rows, error: null }).then(r); } }; return a; };
          app.auth = app.auth || {};
          app.auth.supabase = { from: (t) => api(t === 'assignment_submissions' ? subs : []) };
          app.supabaseQuery = (fn) => fn();
          app.classes = [{ id: 'c1', name: 'Invented Science' }];
          document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());
        }""", [subs, enr])
    stub([], {'class_grade': 0})
    pg.evaluate("app.viewStudentGrades('c1', 's1', 'Nell Nothingyet')"); pg.wait_for_timeout(500)
    t = pg.inner_text('body')
    ok('staff view: nothing graded says "No grades yet", not "Overall: 0%"', 'No grades yet' in t and 'Overall: 0%' not in t)
    stub([{'status': 'graded', 'grade': 'B', 'points_earned': 8, 'assignments': {'title': 'Lab', 'max_points': 10, 'due_date': '2026-09-20'}}], {'class_grade': 84})
    pg.evaluate("app.viewStudentGrades('c1', 's2', 'Gus Graded')"); pg.wait_for_timeout(500)
    ok('  with graded work it shows the overall grade', 'Overall: 84%' in pg.inner_text('body'))

    # ---- parent list: late chip (the rule, then the markup) ----
    late = pg.evaluate("app._submittedLate({ status: 'graded', submitted_at: '2026-09-21T10:00:00Z' }, { due_date: '2026-09-20T23:59:00Z' })")
    ontime = pg.evaluate("app._submittedLate({ status: 'submitted', submitted_at: '2026-09-19T10:00:00Z' }, { due_date: '2026-09-20T23:59:00Z' })")
    ok('late rule: after the due date is late, before is not', late is True and ontime is False)
    src = open(os.path.join(os.path.dirname(__file__), '..', 'portal', 'index.html'), encoding='utf-8').read()
    ok('the parent child-status line uses it', 'const lateChip = (isGraded || isSubmitted) && this._submittedLate(submission, assignment)' in src
       and '${statusText}${lateChip}' in src)

    ok('no page errors', not errs, '; '.join(errs[:2]))
    b.close()
print('FAILS:', fails); sys.exit(1 if fails else 0)
