# The student's portal Home, and the parent's view of the same child, driven
# the way they are used, at phone (420px) and desktop width.
#
#   STUDENT  Home heading -> "Do this next" (each kind of button: hand in,
#            play, practise a stuck skill) -> attendance line -> Coming up
#            (unsubmitted work keeps its urgency, handed-in reads done) ->
#            game homework progress + "Finished recently" -> skill-mastery
#            modal's Practise button -> GPA / strikes cards (profile id, not
#            login id) -> every deep link (?go=assignment / homework / grades)
#            -> My Grades "No grades yet" -> "Submitted late".
#   PARENT   child card -> progress panel -> "Skills & practice".
#
# Every name, id and number is invented. The student's LOGIN id and PROFILE id
# differ on purpose - that is the shape of a pupil the school entered before
# they had a login, and the shape the GPA/strikes fix is about.
#
# The page is the real portal/index.html; only the network is stubbed
# (app.auth.supabase, app._pickupRpc). Rows are handed back as copies.
#
#   python -m http.server 8786          (from the repo root; 8786 only -
#                                        8765 is a production service here)
#   python debug-tools/student-portal-journey.py [screenshot dir]
#
# Needs Python Playwright and installed Chrome (SP_CHROME to override,
# SP_URL for another address).
import os, sys, tempfile
from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

OUT = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='student-portal-')
URL = os.environ.get('SP_URL', 'http://localhost:8786/portal/index.html')
CHROME = os.environ.get('SP_CHROME', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
os.makedirs(OUT, exist_ok=True)

passed = failed = 0
def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1; print(f'    ok   {label}')
    else:
        failed += 1; print(f'  FAIL   {label}\n         expected {expected!r}\n         got      {actual!r}')
def ok(label, cond, detail=None):
    if not cond and detail is not None:
        print(f'         ({detail!r})')
    check(label, bool(cond), True)

# Ids look like UUIDs because the deep-link handler refuses anything that
# does not; the digits say what each one is.
A1, A2, A3, A4, A5 = ('aaaaaaaa-0000-4000-8000-00000000000' + str(i) for i in range(1, 6))
C1, C2 = 'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002'
H1, H2, H3 = ('bbbbbbbb-0000-4000-8000-00000000000' + str(i) for i in range(1, 4))

# Built in the page so "due today" is always today.
BOOT = r"""
({ role, ids }) => {
  const { A1, A2, A3, A4, A5, C1, C2, H1, H2, H3 } = ids;
  const day = 86400000, now = Date.now();
  const at = (d, h = 12) => { const x = new Date(now + d * day); x.setHours(h, 0, 0, 0); return x.toISOString(); };
  const ymd = (d) => { const x = new Date(now + d * day); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const Q = { id: 'q1', name: 'Q1', school_year: '2026-2027', start_date: ymd(-30), end_date: ymd(40), is_current: true };

  const T = window.__T = {
    quarters: [Q],
    classes: [
      { id: C1, name: 'Invented Pre-Algebra', subject: 'Math', teacher_id: 't1', is_active: true, status: 'active' },
      { id: C2, name: 'Invented Life Science', subject: 'Science', teacher_id: 't1', is_active: true, status: 'active' },
    ],
    class_enrollments: [
      // c1 has a real grade; c2 has nothing graded and the 0 the old
      // COALESCE(NULL, 0) writes - the "0.0" shape.
      { id: 'e1', class_id: C1, student_id: 'p-ines', status: 'active', academic_grade: 88.5, class_grade: 88.5, participation_grade: 90, current_quarter_id: 'q1' },
      { id: 'e2', class_id: C2, student_id: 'p-ines', status: 'active', academic_grade: 0, class_grade: 0, participation_grade: null, current_quarter_id: 'q1' },
    ],
    // GPA reads snapshots joined to the enrolment; the stub matches the
    // join filter by its literal column name.
    quarter_grade_snapshots: [
      { quarter_id: 'q1', enrollment_id: 'e9', class_grade: 91, 'class_enrollments.student_id': 'p-ines',
        class_enrollments: { class_id: C1, student_id: 'p-ines' } },
    ],
    assignments: [
      { id: A1, class_id: C1, title: 'Ratio worksheet', due_date: at(-3), is_published: true, assigned_to_all: true, max_points: 20, description: 'Do the ratio sheet.' },
      { id: A2, class_id: C2, title: 'Leaf sketch', due_date: at(0, 23), is_published: true, assigned_to_all: true, max_points: 10, description: 'Sketch a leaf.' },
      { id: A3, class_id: C2, title: 'Seed journal', due_date: at(1, 9), is_published: true, assigned_to_all: true, max_points: 10, description: 'Journal.' },
      { id: A4, class_id: C1, title: 'Chapter 4 review', due_date: at(-6), is_published: true, assigned_to_all: true, max_points: 100, description: 'Review.' },
      { id: A5, class_id: C2, title: 'Cell diagram', due_date: at(4), is_published: true, assigned_to_all: true, max_points: 10, description: 'Draw it.' },
    ],
    assignment_submissions: [
      // Handed in a day AFTER it was due, then graded: the late shape.
      { id: 's4', assignment_id: A4, student_id: 'p-ines', status: 'graded', grade: 'B+', points_earned: 88,
        submitted_at: at(-5), graded_at: at(-4), content: 'My review.' },
      { id: 's3', assignment_id: A3, student_id: 'p-ines', status: 'submitted', submitted_at: at(-1), content: 'Day 1.' },
    ],
    homework_assignments: [
      { id: H1, student_id: 'p-ines', assignment_type: 'game', game_id: 'mathletics', title: 'Mathletics warm-up', subject: 'Math',
        status: 'in_progress', min_score: 70, min_play_time: 10, best_score: 55, play_seconds: 372, due_date: at(2), classes: { name: 'Invented Pre-Algebra', subject: 'Math' } },
      { id: H2, student_id: 'p-ines', assignment_type: 'skill_mastery', skill_name: 'Fractions of a Shape', title: "Fractions - Ines's goal", subject: 'Math',
        status: 'assigned', target_mastery_score: 80, due_date: at(5), classes: { name: 'Invented Pre-Algebra', subject: 'Math' } },
      { id: H3, student_id: 'p-ines', assignment_type: 'game', game_id: 'mathspire', title: 'Mathspire climb', subject: 'Math',
        status: 'completed', final_score: 82, play_seconds: 734, completed_at: at(-2), due_date: at(-1), classes: { name: 'Invented Pre-Algebra', subject: 'Math' } },
    ],
    skill_progress: [{ user_id: 'p-ines', subject: 'Math', skill_name: 'Fractions of a Shape', mastery_score: 45, state: 'in_progress' }],
    student_strikes: [{ id: 'k1', student_id: 'p-ines', reason: 'Invented reason', issued_by: 't1', created_at: at(-3) }],
    user_profiles: [{ id: 'p-ines', rtc_balance: 12 }, { id: 't1', first_name: 'Ada', last_name: 'Teacher' }],
  };

  // The overview the RPC returns. Shapes match rt_student_overview.
  const OV = (sid, first) => ({
    success: true,
    student: { id: sid, first_name: first, last_name: 'Whitfield', rtc_balance: 12 },
    quarter: { id: 'q1', name: 'Q1', start_date: Q.start_date, end_date: Q.end_date },
    classes: [], missing: [], due_soon: [],
    practice: [
      { id: H1, type: 'game', title: 'Mathletics warm-up', subject: 'Math', game_id: 'mathletics', skill_name: null, due_date: at(2),
        status: 'in_progress', min_score: 70, min_play_time: 10, target: null, best_score: 55, play_seconds: 372, current_mastery: null, overdue: false },
      { id: H2, type: 'skill_mastery', title: "Fractions - Ines's goal", subject: 'Math', game_id: null, skill_name: 'Fractions of a Shape', due_date: at(5),
        status: 'assigned', min_score: null, min_play_time: null, target: 80, best_score: null, play_seconds: 0, current_mastery: 45, overdue: false },
    ],
    practice_done: [{ id: H3, type: 'game', title: 'Mathspire climb', game_id: 'mathspire', skill_name: null, final_score: 82, play_seconds: 734, completed_at: at(-2) }],
    skills: {
      by_subject: [{ subject: 'Math', mastered: 12, working: 3 }, { subject: 'Creative', mastered: 2, working: 1 }],
      stuck: [{ subject: 'Math', skill: 'Long Division', mastery: 42, practices: 7 }],
      fading: [{ subject: 'Creative', skill: 'Colour Mixing', last: at(-41) }],
      recent_mastered: [{ subject: 'Math', skill: 'Place Value', at: at(-4), source: 'dojo' }],
      mastered_this_quarter: 4,
    },
    week: [
      { subject: 'Math', this_sessions: 3, this_questions: 40, this_correct: 31, this_minutes: 25, last_sessions: 1, last_questions: 10, last_correct: 6, last_minutes: 10 },
      { subject: 'Reading', this_sessions: 0, this_questions: 0, this_correct: 0, this_minutes: 0, last_sessions: 2, last_questions: 12, last_correct: 9, last_minutes: 14 },
    ],
    attendance: { present: 39, late: 2, absent: 3, absent_excused: 1, left_early: 0, days: 44,
      recent: [{ date: ymd(-2), status: 'absent', excused: true }, { date: ymd(-9), status: 'late', excused: false }] },
    planned_absences: [{ start: ymd(9), end: ymd(11), reason: 'Family trip', excused: true }],
    next: [
      { rank: 1, kind: 'missing', title: 'Ratio worksheet', detail: 'Invented Pre-Algebra', due_at: at(-3), assignment_id: A1, class_id: C1 },
      { rank: 2, kind: 'due_soon', title: 'Leaf sketch', detail: 'Invented Life Science', due_at: at(0, 23), assignment_id: A2, class_id: C2 },
      { rank: 3, kind: 'game', title: 'Mathletics warm-up', detail: 'Goal: 70% and 10 minutes', due_at: at(2), homework_id: H1, overdue: false },
      { rank: 3, kind: 'skill', title: "Fractions - Ines's goal", detail: 'Goal: Fractions of a Shape to 80%', due_at: at(5), homework_id: H2, overdue: false },
      { rank: 4, kind: 'stuck', title: 'Long Division', detail: 'Math · 42% after 7 tries', subject: 'Math', skill: 'Long Division' },
      { rank: 5, kind: 'fading', title: 'Colour Mixing', detail: 'Creative · last practised Aug 22', subject: 'Creative', skill: 'Colour Mixing' },
    ],
  });

  const OPS = { eq: (a, b) => (a ?? null) === b, neq: (a, b) => a !== b, in: (a, b) => b.includes(a),
    gte: (a, b) => a >= b, gt: (a, b) => a > b, lte: (a, b) => a <= b, lt: (a, b) => a < b, is: (a, b) => (a ?? null) === b };
  const build = tb => {
    const f = []; let one = false, ord = null, lim = null;
    const api = {
      select() { return api; }, or() { return api; }, not() { return api; }, range() { return api; },
      order(k, o) { ord = [k, o?.ascending === false ? -1 : 1]; return api; },
      limit(n) { lim = n; return api; },
      single() { one = true; return api; }, maybeSingle() { one = true; return api; },
      insert() { return api; }, upsert() { return api; }, update() { return api; }, delete() { return api; },
      then(res, rej) {
        let rows = (T[tb] || []).filter(r => f.every(([op, k, v]) => OPS[op](r[k], v)));
        if (ord) rows.sort((a, b) => (a[ord[0]] > b[ord[0]] ? 1 : a[ord[0]] < b[ord[0]] ? -1 : 0) * ord[1]);
        if (lim) rows = rows.slice(0, lim);
        // copies, never the rows themselves
        const out = JSON.parse(JSON.stringify(one ? (rows[0] || null) : rows));
        return new Promise(r => setTimeout(r, 10)).then(() => ({ data: out, error: null })).then(res, rej);
      },
    };
    Object.keys(OPS).forEach(op => { api[op] = (k, v) => { f.push([op, k, v]); return api; }; });
    return api;
  };
  app.auth.supabase = { from: build, rpc: () => Promise.resolve({ data: null, error: null }),
                        auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
                        channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {} };
  window.__rpc = [];
  app._pickupRpc = async (fn, args) => {
    window.__rpc.push([fn, JSON.parse(JSON.stringify(args || {}))]);
    await new Promise(r => setTimeout(r, 20));
    if (fn === 'rt_student_overview') {
      const sid = args?.p_student_id || 'p-ines';
      return OV(sid, sid === 'p-milo' ? 'Milo' : 'Ines');
    }
    return null;
  };
  app.showNotification = (m, t) => { (window.__notes = window.__notes || []).push([t, m]); };
  app.messageThreads = [];

  if (role === 'student') {
    const profile = { id: 'p-ines', user_type: 'student', first_name: 'Ines', last_name: 'Whitfield' };
    const user = { id: 'u-ines-login', user_metadata: {} };     // NOT the profile id
    app.auth.currentUser = user; app.auth.userProfile = profile;
    app.userInfo = { user, profile };
    app.classes = JSON.parse(JSON.stringify(T.classes));
  } else {
    const profile = { id: 'p-dana', user_type: 'parent', first_name: 'Dana', last_name: 'Whitfield' };
    const user = { id: 'u-dana-login', user_metadata: {} };
    app.auth.currentUser = user; app.auth.userProfile = profile;
    app.userInfo = { user, profile };
    app.children = [{ id: 'p-milo', first_name: 'Milo', last_name: 'Whitfield', email: 'milo@example.invalid', grade_level: 6,
      enrollment_type: 'full_time', auth_user_id: 'u-milo', classes: [JSON.parse(JSON.stringify(T.classes[0]))] }];
    app.classes = JSON.parse(JSON.stringify(T.classes));
  }
  document.getElementById('loading-screen')?.classList.add('hidden');
  document.getElementById('auth-required')?.classList.add('hidden');
  document.getElementById('main-app')?.classList.remove('hidden');
  app._lastHomeSetup = 0;
  app.showSection('home');
}
"""

IDS = dict(A1=A1, A2=A2, A3=A3, A4=A4, A5=A5, C1=C1, C2=C2, H1=H1, H2=H2, H3=H3)
NO_HSCROLL = "() => document.documentElement.scrollWidth <= window.innerWidth + 1"
TEXT = "(sel) => (document.querySelector(sel)?.innerText || '').replace(/\\s+/g, ' ').trim()"
OPEN = "(id) => !!document.getElementById('modal-' + id)"
CLOSE_ALL = "() => document.querySelectorAll('.modal-backdrop').forEach(m => m.remove())"
IFRAME = "() => document.querySelector('#modal-game-player iframe')?.getAttribute('src') || ''"


def start(pw, width, height, role, query=''):
    browser = pw.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)
    page = browser.new_page(viewport={'width': width, 'height': height})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL + query)
    page.wait_for_function('() => window.app && window.app.auth', timeout=30000)
    page.evaluate(BOOT, {'role': role, 'ids': IDS})
    page.wait_for_timeout(900)
    return browser, page, errors


def student_journey(pw, width, height, tag):
    print(f'\n== student, {tag} ({width}px) ==')
    # Arrive the way the student site's link arrives, with a hash that sends
    # init through showSection('home') - which rewrites the URL.
    browser, page, errors = start(pw, width, height, 'student', f'?go=grades&class={C2}#home')
    shot = lambda name: page.screenshot(path=os.path.join(OUT, f'student-{tag}-{name}.png'), full_page=False)

    print('0. the query string is kept from arrival, before routing can rewrite it')
    ok('init captured ?go=grades on arrival', 'go=grades' in (page.evaluate('() => app._arrivalSearch') or ''))

    print('1. Home says what it is')
    check('heading', page.evaluate(TEXT, '#home-heading'), '🏠 Your dashboard')

    print('2. Do this next')
    page.wait_for_selector('#student-next-card', timeout=5000)
    kinds = page.evaluate("() => [...document.querySelectorAll('#student-next-card .next-item')].map(r => r.dataset.kind)")
    check('first five items, in the overview\'s order', kinds, ['missing', 'due_soon', 'game', 'skill', 'stuck'])
    card = page.evaluate(TEXT, '#student-next-card')
    ok('says there is more after these', '+ 1 more after these' in card, card)
    ok('game row shows the whole goal and progress', 'Best 55% of 70% · 6 of 10 minutes' in card, card)
    ok('overdue work says when it was due', 'was due' in card, card)
    ok('due-tonight work says due today', 'due today' in card, card)
    att = page.evaluate(TEXT, '#student-attendance-line')
    check('attendance this quarter', att, '🗓️ Attendance this quarter (Q1): In school 41 of 44 days · 2 late · 3 absent (1 excused)')
    ok('rt_student_overview asked for the signed-in student (no id)',
       ['rt_student_overview', {'p_student_id': None}] in page.evaluate('() => window.__rpc'))
    page.locator('#student-next-card').scroll_into_view_if_needed()
    shot('1-do-this-next')

    print('3. each kind of button goes to the right place')
    page.locator('#student-next-card .next-item[data-kind="missing"] button').click()
    page.wait_for_selector('#modal-submit-assignment', timeout=5000)
    ok('Hand in opens that assignment', 'Ratio worksheet' in page.evaluate(TEXT, '#modal-submit-assignment'))
    page.evaluate(CLOSE_ALL)
    page.locator('#student-next-card .next-item[data-kind="game"] button').click()
    page.wait_for_selector('#modal-game-player iframe', timeout=5000)
    src = page.evaluate(IFRAME)
    ok('Play launches that homework (game + its id)', '/games/mathletics.html?homework=' + H1 in src, src)
    page.evaluate(CLOSE_ALL)
    page.locator('#student-next-card .next-item[data-kind="stuck"] button').click()
    page.wait_for_selector('#modal-game-player iframe', timeout=5000)
    src = page.evaluate(IFRAME)
    ok('a stuck Math skill opens Math Dojo', '/games/math-dojo.html' in src and 'userId=p-ines' in src, src)
    req = page.evaluate("() => JSON.parse(localStorage.getItem('tree_practice_request') || 'null')")
    check('  on that skill', (req or {}).get('skill'), 'Long Division')
    page.evaluate(CLOSE_ALL)

    print('4. Coming up: work still to do keeps its urgency')
    page.wait_for_function("() => document.querySelector('#due-this-week-container .list')", timeout=5000)
    rows = page.evaluate("""() => [...document.querySelectorAll('#due-this-week-container .list-item')].map(r => ({
        t: r.querySelector('.list-item-title')?.innerText.trim(), meta: r.querySelector('.list-item-meta')?.innerText.replace(/\\s+/g, ' '),
        border: r.style.borderLeft }))""")
    leaf = next((r for r in rows if r['t'] == 'Leaf sketch'), None)
    seed = next((r for r in rows if r['t'] == 'Seed journal'), None)
    ok('unsubmitted work due tonight says DUE TODAY', leaf and 'DUE TODAY' in leaf['meta'], leaf)
    ok('  in the danger colour', leaf and 'danger' in leaf['border'], leaf)
    ok('handed-in work reads as handed in', seed and 'Handed in' in seed['meta'], seed)
    page.locator('#due-this-week-container').scroll_into_view_if_needed()
    shot('2-coming-up')

    print('5. game homework: the whole goal, progress, and what was finished')
    page.wait_for_function("() => document.querySelector('#game-homework-container .homework-progress-line')", timeout=5000)
    lines = page.evaluate("() => [...document.querySelectorAll('#game-homework-container .homework-progress-line')].map(e => e.innerText.trim())")
    check('progress lines', lines, ['Best 55% of 70% · 6 of 10 minutes', 'Fractions of a Shape: now 45% of 80%'])
    hw = page.evaluate(TEXT, '#game-homework-container')
    ok('a Finished recently list', 'Finished recently' in hw, hw)
    ok('  with score and time', 'Scored 82% · 12 min played · finished' in hw, hw)
    page.locator('#game-homework-container').scroll_into_view_if_needed()
    shot('3-practice')

    print('6. the skill-mastery modal opens the practice')
    page.locator('#game-homework-container .list-item', has_text='Fractions').locator('button').click()
    page.wait_for_selector('#skill-practice-open', timeout=5000)
    check('button names the place', page.evaluate(TEXT, '#skill-practice-open'), '🥋 Practise in Math Dojo')
    shot('4-skill-modal')
    page.locator('#skill-practice-open').click()
    page.wait_for_selector('#modal-game-player iframe', timeout=5000)
    ok('it opens Math Dojo', '/games/math-dojo.html' in page.evaluate(IFRAME))
    check('  on the assigned skill', (page.evaluate("() => JSON.parse(localStorage.getItem('tree_practice_request') || 'null')") or {}).get('skill'),
          'Fractions of a Shape')
    ok('  and the skill modal is gone', not page.evaluate(OPEN, 'skill-practice'))
    page.evaluate(CLOSE_ALL)

    print('7. GPA and strikes find the pupil by profile id')
    page.wait_for_function("() => /Cumulative GPA/.test(document.getElementById('student-gpa-container')?.innerText || '')", timeout=5000)
    gpa = page.evaluate(TEXT, '#student-gpa-container')
    ok('Q1 shows the snapshot grade (91.0%)', '91.0%' in gpa, gpa)
    page.wait_for_function("() => (document.getElementById('student-strikes-count')?.textContent || '-') !== '-'", timeout=5000)
    check('strike count', page.evaluate(TEXT, '#student-strikes-count'), '1/3')

    print('8. deep links')
    # The one we arrived with: the harness stands in for the end of init.
    check('arrival link handled', page.evaluate('() => app.handlePortalDeepLink(app._arrivalSearch)'), 'grades')
    page.wait_for_selector('#modal-grades', timeout=5000)
    g = page.evaluate(TEXT, '#modal-grades')
    ok('My Grades for that class opens', 'Invented Life Science' in g, g)
    check('"No grades yet" in both grade boxes, never 0.0', (g.count('No grades yet'), '0.0' in g), (2, False))
    ok('  and says why', 'Nothing has been graded' in g, g)
    shot('5-no-grades-yet')
    page.evaluate(CLOSE_ALL)

    def follow(query):
        page.evaluate('(q) => history.replaceState(null, "", location.pathname + q)', query)
        kind = page.evaluate('() => app.handlePortalDeepLink(location.search)')
        left = page.evaluate('() => location.search')
        return kind, left

    kind, left = follow(f'?go=assignment&class={C1}&id={A4}')
    check('?go=assignment', kind, 'assignment')
    check('  params removed so a refresh does not reopen it', left, '')
    page.wait_for_selector('#modal-submit-assignment', timeout=5000)
    sub = page.evaluate(TEXT, '#modal-submit-assignment')
    ok('  opens that assignment', 'Chapter 4 review' in sub, sub)
    ok('  and says it was submitted late', 'Submitted late' in sub, sub)
    shot('6-submitted-late')
    page.evaluate(CLOSE_ALL)

    kind, left = follow(f'?go=homework&id={H1}')
    check('?go=homework', kind, 'homework')
    page.wait_for_selector('#modal-game-player iframe', timeout=5000)
    ok('  launches the game with its homework id', ('homework=' + H1) in page.evaluate(IFRAME))
    check('  params removed', left, '')
    page.evaluate(CLOSE_ALL)

    kind, _ = follow(f'?go=grades&class={C1}')
    check('?go=grades (a class with grades)', kind, 'grades')
    page.wait_for_selector('#modal-grades', timeout=5000)
    g = page.evaluate(TEXT, '#modal-grades')
    ok('  shows the grade', '88.5' in g and 'No grades yet' not in g, g)
    ok('  and marks the late piece', 'Submitted late' in g, g)
    page.evaluate(CLOSE_ALL)

    kind, left = follow('?go=assignment&id=not-an-id')
    check('junk id is refused', kind, None)
    check('  but still cleared', left, '')

    ok('no horizontal scroll', page.evaluate(NO_HSCROLL))
    real = [e for e in errors if not any(w in e.lower() for w in ('supabase', 'fetch', 'network', 'google', 'quill'))]
    check('no page errors', real, [])
    browser.close()


def parent_journey(pw, width, height, tag):
    print(f'\n== parent, {tag} ({width}px) ==')
    browser, page, errors = start(pw, width, height, 'parent')
    shot = lambda name: page.screenshot(path=os.path.join(OUT, f'parent-{tag}-{name}.png'), full_page=False)
    check('parent heading unchanged', page.evaluate(TEXT, '#home-heading'), '📚 Welcome to Classes & Messaging')

    page.evaluate("() => app.showChildDetails('p-milo')")
    page.wait_for_selector('#child-overview', timeout=8000)
    ok('asked for that child', ['rt_student_overview', {'p_student_id': 'p-milo'}] in page.evaluate('() => window.__rpc'))
    s = page.evaluate(TEXT, '#child-overview')
    for label, needle in [
        ('section heading', 'Skills & practice'),
        ("what's next, in parent words", "What's next for Milo"),
        ('  overdue work named as such', 'Overdue work'),
        ('  a stuck skill in plain words', 'Finding this one hard'),
        ('practice this week vs last', 'This week: 3 sessions, 25 min, 40 questions (78% right) · Last week: 1 session, 10 min'),
        ('  a subject practised only last week', 'English This week: none yet · Last week: 2 sessions, 14 min'),
        ('assigned practice with progress', 'Best 55% of 70% · 6 of 10 minutes'),
        ('  skill progress', 'Fractions of a Shape: now 45% of 80%'),
        ('finished recently', 'Scored 82% · 12 min played'),
        ('skill totals, friendly subjects', 'Math: 12 mastered, 3 being worked on · Art: 2 mastered, 1 being worked on'),
        ('mastered this quarter', '4 new skills mastered this quarter'),
        ('stuck skill', 'Long Division'),
        ('fading skill', 'Colour Mixing'),
        ('recently mastered', 'Place Value'),
        ('attendance this quarter', 'In school 41 of 44 days · 2 late · 3 absent (1 excused)'),
        ('recent attendance days', 'Absent (excused)'),
        ('planned absence', 'Family trip · excused'),
    ]:
        ok(label, needle in s, s[:300] if needle not in s else None)
    ok('no raw subject codes', 'Creative' not in s and 'Reading' not in s, s)
    page.locator('#child-overview').scroll_into_view_if_needed()
    shot('1-skills-and-practice')
    page.locator('#child-attendance-line').scroll_into_view_if_needed()
    shot('2-attendance')
    ok('no horizontal scroll', page.evaluate(NO_HSCROLL))
    real = [e for e in errors if not any(w in e.lower() for w in ('supabase', 'fetch', 'network', 'google', 'quill'))]
    check('no page errors', real, [])
    browser.close()


with sync_playwright() as pw:
    for w, h, tag in [(420, 900, 'phone'), (1280, 900, 'desktop')]:
        student_journey(pw, w, h, tag)
        parent_journey(pw, w, h, tag)

print(f'\n{passed} passed, {failed} failed   (screenshots: {OUT})')
sys.exit(1 if failed else 0)
