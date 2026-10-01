# Class Progress, driven the way a teacher uses it, at phone and desktop width.
#
#   class card 📈 -> progress screen -> Stuck chip -> sort -> Skills grid ->
#   tap a stuck square (detail + history) -> a student's name -> Student Hub
#   on Skill Trees for that subject -> back -> Game & skill assignments ->
#   expand a batch. Then the seams the same data feeds: the class's
#   Assignments list, the roster's last-active line, Class Analytics, and the
#   hub's Weekly Activity and Activity Log tabs.
#
# Every name and number below is invented. The roster reproduces shapes,
# not people: two students who share a first name and a last initial, a
# surname that is an ordinary word, a student who has never practised.
#
#   python -m http.server 8782 &        (from the repo root)
#   python debug-tools/class-progress-journeys.py [screenshot dir]
#
# Needs Python Playwright. Uses installed Chrome; set CP_CHROME to another
# browser binary, CP_URL to another address.
import json, os, sys, tempfile
from playwright.sync_api import sync_playwright

# Windows consoles default to cp1252, which cannot print the emoji labels.
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

OUT = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='class-progress-')
URL = os.environ.get('CP_URL', 'http://localhost:8782/portal/index.html')
CHROME = os.environ.get('CP_CHROME', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
os.makedirs(OUT, exist_ok=True)

passed = failed = 0
def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1; print(f'    ok   {label}')
    else:
        failed += 1; print(f'  FAIL   {label}\n         expected {expected!r}\n         got      {actual!r}')
def ok(label, cond):
    check(label, bool(cond), True)

# The fixtures are built in the page, so "3 days ago" is always 3 days ago.
BOOT = r"""
({ width }) => {
  const day = 86400000, now = Date.now();
  const ago = (d, h = 0) => new Date(now - d * day - h * 3600000).toISOString();
  const ymd = (d) => { const x = new Date(now + d * day); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const S = (id, first, last, extra) => Object.assign({ id, first_name: first, last_name: last, grade_level: 4,
    last_active: null, sessions_7d: 0, questions_7d: 0, correct_7d: 0, minutes_7d: 0, mastered: 0, in_progress: 0,
    stuck: 0, fading: 0, skills_total: 0, mastered_30d: 0, homework_open: 0, homework_overdue: 0 }, extra);
  const students = [
    S('s1', 'Mara', 'Okonkwo-Lindqvist', { last_active: ago(0, 1), sessions_7d: 5, questions_7d: 120, correct_7d: 102, minutes_7d: 64, mastered: 6, in_progress: 2, skills_total: 8 }),
    S('s2', 'Mara', 'Ozturk', { last_active: ago(3), sessions_7d: 2, questions_7d: 40, correct_7d: 18, minutes_7d: 21, mastered: 1, in_progress: 3, stuck: 2, skills_total: 4, homework_overdue: 1 }),
    S('s3', 'Theo', 'Bell', { last_active: ago(12), mastered: 3, fading: 1, skills_total: 4, homework_overdue: 1 }),
    S('s4', 'Ines', 'Park', { last_active: ago(1), sessions_7d: 3, questions_7d: 75, correct_7d: 60, minutes_7d: 30, mastered: 2, in_progress: 2, stuck: 1, skills_total: 4 }),
    S('s5', 'Juno', 'Whitfield-Abernathy-Castellanos', {}),
    S('s6', 'Sol', 'Reyes', { last_active: ago(2), sessions_7d: 1, questions_7d: 0, minutes_7d: 5, skills_total: 1 }),
  ];
  const K = (sid, skill, node, state, mastery, practices, flag = null, extra = {}) => Object.assign({ student_id: sid, subject: 'Math', skill,
    node_id: node, state, mastery, p: mastery / 100, practices, last: ago(practices ? 2 : 40), source: 'dojo', mastered_at: state === 'mastered' ? ago(20) : null, flag }, extra);
  const NAMES = ['Counting to 100', 'Place Value', 'Adding within 20', 'Subtracting within 20', 'Skip Counting',
                 'Equal Groups', 'Arrays', 'Fractions of a Shape', 'Telling Time', 'Money', 'Measuring Length', 'Bar Graphs'];
  const skills = [];
  NAMES.forEach((n, i) => {
    skills.push(K('s1', n, 'M' + (100 + i), i < 6 ? 'mastered' : 'in_progress', i < 6 ? 95 : 70, 6));
    if (i < 4) skills.push(K('s2', n, 'M' + (100 + i), i === 0 ? 'mastered' : 'in_progress', i === 0 ? 88 : (i === 2 ? 41 : 52), i === 0 ? 3 : 7, i === 2 || i === 3 ? 'stuck' : null));
    if (i < 4) skills.push(K('s3', n, 'M' + (100 + i), i < 3 ? 'mastered' : 'available', i < 3 ? 85 : 0, i < 3 ? 4 : 0, i === 1 ? 'fading' : null, i === 1 ? { last: ago(41), source: 'math-tutor' } : {}));
    if (i >= 2 && i < 6) skills.push(K('s4', n, 'M' + (100 + i), i < 4 ? 'mastered' : 'in_progress', i < 4 ? 90 : 38, 5, i === 5 ? 'stuck' : null, { source: 'homework' }));
  });
  skills.push(K('s6', 'Counting to 100', 'M100', 'activated', 12, 1));
  skills.push(K('s2', 'Colour Mixing', 'A100', 'in_progress', 30, 2, null, { subject: 'Creative', source: 'game' }));
  window.__FX = {
    progress: { class: { id: 'c1', name: 'Invented Number Sense', subject: 'Math' }, subject: null,
      subjects: [{ subject: 'Math', students: 5, skills: 12 }, { subject: 'Creative', students: 1, skills: 1 }], students, skills },
    homework: [
      { key: 'b1', title: 'Mathletics Practice', type: 'game', game_id: 'mathletics', subject: 'Math', skill_name: null,
        due_date: ymd(-1), assigned_at: ago(6), min_score: 70, min_play_time: 10, target_mastery_score: null,
        assigned: 4, completed: 2, started: 1, overdue: 1,
        students: [
          { id: 'h1', student_id: 's1', first_name: 'Mara', last_name: 'Okonkwo-Lindqvist', status: 'completed', best_score: 92, final_score: null, play_seconds: 734, attempts: 3, started_at: ago(5), completed_at: ago(4), last_session_at: ago(4), overdue: false, enrolled: true },
          { id: 'h2', student_id: 's2', first_name: 'Mara', last_name: 'Ozturk', status: 'assigned', best_score: null, final_score: null, play_seconds: 0, attempts: 0, overdue: true, enrolled: true },
          { id: 'h3', student_id: 's4', first_name: 'Ines', last_name: 'Park', status: 'completed', best_score: 74, play_seconds: 615, attempts: 2, completed_at: ago(2), overdue: false, enrolled: true },
          { id: 'h4', student_id: 's9', first_name: 'Rafe', last_name: 'Quill', status: 'in_progress', best_score: 55, play_seconds: 125, attempts: 1, overdue: false, enrolled: false },
        ] },
      { key: 'b2', title: 'Fractions check', type: 'skill_mastery', game_id: null, subject: 'Math', skill_name: 'Fractions of a Shape',
        due_date: ymd(5), assigned_at: ago(1), min_score: null, min_play_time: null, target_mastery_score: 80,
        assigned: 2, completed: 0, started: 1, overdue: 0,
        students: [
          { id: 'h5', student_id: 's3', first_name: 'Theo', last_name: 'Bell', status: 'in_progress', best_score: 61, play_seconds: 300, attempts: 1, overdue: false, enrolled: true },
          { id: 'h6', student_id: 's5', first_name: 'Juno', last_name: 'Whitfield-Abernathy-Castellanos', status: 'assigned', best_score: null, play_seconds: 0, attempts: 0, overdue: false, enrolled: true },
        ] },
    ],
  };
  const T = window.__T = {
    classes: [{ id: 'c1', name: 'Invented Number Sense', subject: 'Math', grade_band: null, status: 'active',
                max_students: 12, class_code: 'NUM1', teacher_id: 'u-t', is_active: true, student_count: 6 }],
    class_enrollments: [
      ...students.map((s, i) => ({ id: 'e' + i, class_id: 'c1', student_id: s.id, status: 'active', enrolled_at: ago(30) })),
      { id: 'e8', class_id: 'c1', student_id: 's9', status: 'archived', enrolled_at: ago(60) },
      { id: 'e9', class_id: 'c1', student_id: 's10', status: 'removed', enrolled_at: ago(60) },
    ],
    user_profiles: [...students.map(s => ({ id: s.id, first_name: s.first_name, last_name: s.last_name, grade_level: 4,
      email: s.id + '@example.invalid', username: s.id, account_status: 'activated', user_type: 'student' })),
      { id: 's9', first_name: 'Rafe', last_name: 'Quill', grade_level: 4 }],
    skill_progress: [
      ...skills.map(k => ({ user_id: k.student_id, subject: k.subject, skill_name: k.skill, state: k.state, mastery_score: k.mastery,
        last_practiced: k.last, practice_count: k.practices, source: k.source, mastered_at: k.mastered_at })),
    ],
    skill_progress_history: [
      { user_id: 's2', subject: 'Math', skill_name: 'Adding within 20', old_state: 'available', new_state: 'in_progress', old_score: 0, new_score: 30, source: 'dojo', actor_type: 'student', changed_at: ago(9) },
      { user_id: 's2', subject: 'Math', skill_name: 'Adding within 20', old_state: 'in_progress', new_state: 'in_progress', old_score: 30, new_score: 41, source: 'dojo', actor_type: 'student', changed_at: ago(3) },
      { user_id: 's2', subject: 'Math', skill_name: 'Counting to 100', old_state: 'in_progress', new_state: 'mastered', old_score: 70, new_score: 88, source: 'dojo', actor_type: 'student', changed_at: ago(12) },
      { user_id: 's2', subject: 'Math', skill_name: 'Place Value', old_state: 'in_progress', new_state: 'mastered', old_score: 50, new_score: 80, source: 'teacher', actor_type: 'teacher', changed_at: ago(40) },
      { user_id: 's2', subject: 'Math', skill_name: 'Place Value', old_state: 'mastered', new_state: 'in_progress', old_score: 80, new_score: 52, source: 'decay', actor_type: 'system', changed_at: ago(5) },
    ],
    math_dojo_sessions: [
      { user_id: 's2', subject: 'Math', mode: 'practice', total_questions: 20, total_correct: 9, accuracy: 45, skills_practiced: 2, created_at: ago(3), skill_details: [{ skill: 'Adding within 20' }] },
      { user_id: 's2', subject: 'Science', mode: 'practice', total_questions: 10, total_correct: 8, accuracy: 80, skills_practiced: 1, created_at: ago(2) },
      { user_id: 's2', subject: 'Creative', mode: 'lesson', total_questions: 4, total_correct: 4, accuracy: 100, skills_practiced: 1, created_at: ago(1) },
    ],
    skill_practice_sessions: [
      { user_id: 's2', subject: 'Math', skill_name: 'Subtracting within 20', score: 60, correct_count: 6, total_count: 10, source_type: 'game', game_id: 'mathletics', started_at: ago(2, 3) },
    ],
    homework_assignments: [
      { student_id: 's2', title: 'Mathletics Practice', assignment_type: 'game', status: 'in_progress', final_score: null, best_score: 55, play_seconds: 125, updated_at: ago(2), due_date: ymd(-1) },
    ],
  };
  const build = tb => {
    const f = []; let one = false, ord = null;
    const match = r => f.every(([k, v, how]) =>
      how === 'in' ? v.includes(r[k]) : how === 'gte' ? r[k] >= v : how === 'lte' ? r[k] <= v : (r[k] ?? null) === v);
    const api = {
      // order() is honoured: "newest first" is something the page relies on
      order(k, o) { ord = [k, o?.ascending === false ? -1 : 1]; return api; },
      select() { return api; }, limit() { return api; }, or() { return api; },
      neq() { return api; }, not() { return api; }, range() { return api; },
      eq(k, v) { f.push([k, v]); return api; }, is(k, v) { f.push([k, v]); return api; },
      in(k, v) { f.push([k, v, 'in']); return api; },
      gte(k, v) { f.push([k, v, 'gte']); return api; }, lte(k, v) { f.push([k, v, 'lte']); return api; },
      single() { one = true; return api; }, maybeSingle() { one = true; return api; },
      insert() { return api; }, upsert() { return api; }, update() { return api; }, delete() { return api; },
      then(res, rej) {
        const rows = (T[tb] || []).filter(match);
        if (ord) rows.sort((a, b) => (a[ord[0]] > b[ord[0]] ? 1 : a[ord[0]] < b[ord[0]] ? -1 : 0) * ord[1]);
        // copies, never the rows themselves
        const out = JSON.parse(JSON.stringify(one ? (rows[0] || null) : rows));
        return new Promise(r => setTimeout(r, 15)).then(() => ({ data: out, error: null })).then(res, rej);
      },
    };
    return api;
  };
  app.auth.supabase = { from: build, rpc: () => Promise.resolve({ data: null, error: null }),
                        channel: () => ({ on() { return this; }, subscribe() { return this; } }) };
  window.__rpc = [];
  app._pickupRpc = async (fn, args) => {
    window.__rpc.push([fn, args]);
    await new Promise(r => setTimeout(r, 30));
    if (fn === 'rt_class_progress') {
      const p = JSON.parse(JSON.stringify(__FX.progress));
      if (args.p_subject) { p.subject = args.p_subject; p.skills = p.skills.filter(k => k.subject === args.p_subject); }
      return p;
    }
    if (fn === 'rt_class_homework') return JSON.parse(JSON.stringify(__FX.homework));
    return null;
  };
  app.userInfo = { user: { id: 'u-t' }, profile: { id: 'u-t', user_type: 'teacher', first_name: 'Test' } };
  app.showNotification = (m, t) => { (window.__notes = window.__notes || []).push([t, m]); };
  app.classes = JSON.parse(JSON.stringify(T.classes));
  document.getElementById('loading-screen')?.classList.add('hidden');
  document.getElementById('auth-required')?.classList.add('hidden');
  document.getElementById('main-app')?.classList.remove('hidden');
  app.showSection('classes');
}
"""

NO_HSCROLL = "() => document.documentElement.scrollWidth <= window.innerWidth + 1"
ROWS = "() => [...document.querySelectorAll('#cp-body .cp-table tbody tr')].map(r => r.querySelector('.cp-name').textContent.trim().replace(/\\s+/g, ' '))"


def journey(pw, width, height, tag):
    print(f'\n== {tag} ({width}px) ==')
    browser = pw.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)
    page = browser.new_page(viewport={'width': width, 'height': height})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function('() => window.app && window.app.auth', timeout=30000)
    page.evaluate(BOOT, {'width': width})
    page.wait_for_timeout(700)
    shot = lambda name: page.screenshot(path=os.path.join(OUT, f'{tag}-{name}.png'))

    print('1. the 📈 on the class card opens Class Progress')
    btn = page.locator('.class-card button[title="Class progress"]').first
    ok('the class card has a 📈 button', btn.count() == 1)
    btn.locator('xpath=ancestor::div[contains(@class,"class-card")][1]').hover()
    page.wait_for_timeout(250)
    btn.click()
    page.wait_for_selector('#cp-body .cp-table', timeout=5000)
    check('one row per student', len(page.evaluate(ROWS)), 6)
    check('the RPC was asked for this class, all subjects', page.evaluate('() => __rpc[0]'), ['rt_class_progress', {'p_class_id': 'c1', 'p_subject': None}])
    rel = page.evaluate("() => [...document.querySelectorAll('#cp-body .cp-table tbody tr')].map(r => r.children[1].textContent.trim())")
    # by surname: Bell, Okonkwo-Lindqvist, Ozturk, Park, Reyes, Whitfield-...
    check('last active reads as people say it', rel,
          ['12 days ago', 'today', '3 days ago', 'yesterday', '2 days ago', 'never'])
    ok('no sideways page scroll', page.evaluate(NO_HSCROLL))
    shot('1-students')

    print('2. Stuck')
    page.click('#cp-body .cp-chip:has-text("Stuck")')
    page.wait_for_timeout(150)
    check('only the stuck students', sorted(page.evaluate(ROWS)), sorted(['Mara OzturkGr 4', 'Ines ParkGr 4']))
    page.click('#cp-body .cp-sort:has-text("Accuracy")')
    page.wait_for_timeout(150)
    check('sorted by accuracy, best first', page.evaluate(ROWS), ['Ines ParkGr 4', 'Mara OzturkGr 4'])
    shot('2-stuck')
    page.click('#cp-body .cp-chip:has-text("Not active this week")')
    page.wait_for_timeout(150)
    check('not active this week = no practice in 7 days, or never', sorted(page.evaluate(ROWS)),
          sorted(['Theo BellGr 4', 'Juno Whitfield-Abernathy-CastellanosGr 4']))
    page.click('#cp-body .cp-chip:has-text("Fading")')
    page.wait_for_timeout(150)
    check('fading', page.evaluate(ROWS), ['Theo BellGr 4'])
    page.click('#cp-body .cp-chip:has-text("Overdue work")')
    page.wait_for_timeout(150)
    check('overdue work', sorted(page.evaluate(ROWS)), sorted(['Theo BellGr 4', 'Mara OzturkGr 4']))

    print('3. the skills grid')
    page.click('#cp-body .cp-chip:has-text("All")')
    page.click('#cp-body .cp-tab:has-text("Skills grid")')
    page.wait_for_timeout(200)
    cols = page.evaluate("() => document.querySelectorAll('#cp-body .cp-grid th.cp-col').length")
    check('only skills somebody has (12 Math + 1 Art)', cols, 13)
    check('both subjects get a header group', page.evaluate("() => [...document.querySelectorAll('#cp-body .cp-grid .cp-group th[colspan]')].map(t => t.textContent)"), ['Math', 'Art (Art Studio)'])
    check('three stuck squares, one fading', page.evaluate("() => [document.querySelectorAll('#cp-body td.cp-cell.stuck').length, document.querySelectorAll('#cp-body td.cp-cell.fading').length]"), [3, 1])
    labels = page.evaluate("() => [...document.querySelectorAll('#cp-body .cp-grid tbody th.cp-name')].map(t => t.textContent.trim())")
    ok(f'the two Maras (both "O.") get their whole surname: {labels}', 'Mara Ozturk' in labels and 'Mara Okonkwo-Lindqvist' in labels and 'Theo B.' in labels)
    ok('no sideways page scroll', page.evaluate(NO_HSCROLL))
    scroll = page.evaluate("() => { const s = document.querySelector('#cp-body .cp-grid-scroll'); return [s.scrollWidth, s.clientWidth]; }")
    if width < 600:
        ok('the grid scrolls inside itself on a phone', scroll[0] > scroll[1])
        page.evaluate("() => { document.querySelector('#cp-body .cp-grid-scroll').scrollLeft = 200; }")
        page.wait_for_timeout(100)
        x = page.evaluate("() => { const th = document.querySelector('#cp-body .cp-grid tbody th.cp-name'); const s = document.querySelector('#cp-body .cp-grid-scroll'); return Math.round(th.getBoundingClientRect().left - s.getBoundingClientRect().left); }")
        ok(f'  and the name column stays put while it does (offset {x}px)', abs(x) <= 2)
    shot('3-grid')
    page.evaluate("() => { document.querySelector('#cp-body .cp-grid-scroll').scrollLeft = 0; }")

    print('4. a stuck square')
    page.locator('#cp-body td.cp-cell.stuck button[aria-label^="Mara Ozturk - Adding within 20"]').click()
    page.wait_for_selector('#cp-cell-history div', timeout=5000)
    page.wait_for_timeout(200)
    detail = page.inner_text('#modal-skill-cell-detail')
    ok('says it is stuck, and why', 'Stuck: practised 4 or more times and still under 60.' in detail)
    ok('says how it got there', 'Got here through Dojo practice' in detail)
    hist = page.evaluate("() => [...document.querySelectorAll('#cp-cell-history div')].map(d => d.textContent)")
    check('two history rows, newest first', len(hist), 2)
    ok(f'  in words: {hist[0]!r}', 'In progress · 30 → 41 · via Dojo practice' in hist[0])
    shot('4-cell')

    print('5. the student hub, on Skill Trees, for the subject')
    page.click('#modal-skill-cell-detail button:has-text("Student Hub")')
    page.wait_for_selector('#student-hub-overlay #skill-progress-content table', timeout=8000)
    page.wait_for_timeout(300)
    check('opened on the skills tab', page.evaluate("() => document.querySelector('.student-hub-tab[data-tab=skills]').style.color"), 'var(--accent)')
    check('on Math', page.evaluate("() => document.getElementById('skill-subject-select').value"), 'Math')
    opts = page.evaluate("() => [...document.querySelectorAll('#skill-subject-select option')].map(o => o.textContent)")
    ok(f'the picker offers Art Studio, which games write as Creative: {opts}', 'Art (Art Studio) (1)' in opts)
    hub = page.inner_text('#skill-progress-content')
    ok('each skill says how it got there', 'via Dojo practice' in hub)
    ok('this-term summary counts the student\'s own mastery only (1, not the teacher\'s)', 'This term: 1 skill mastered in the last 30 days (1 in Math), 1 skill in the last 90 days (1 in Math).' in ' '.join(hub.split()))
    ok('no sideways page scroll', page.evaluate(NO_HSCROLL))
    shot('5-hub-skills')
    page.select_option('#skill-subject-select', 'Creative')
    page.wait_for_timeout(400)
    ok('switching to Art Studio shows its skill', 'Colour Mixing' in page.inner_text('#skill-progress-content'))

    print('6. weekly activity and the activity log name every subject')
    page.click('.student-hub-tab[data-tab=activity]')
    page.wait_for_timeout(500)
    wk = page.inner_text('#student-weekly-activity-content')
    ok('Science Lab and Art Studio sessions are in the week', 'Science Lab' in wk and 'Art Studio' in wk)
    ok('  and the game session too', 'Mathletics' in wk)
    shot('6-weekly')
    page.click('.student-hub-tab[data-tab=activitylog]')
    page.wait_for_timeout(700)
    log = page.inner_text('#student-activity-log-content')
    ok('the Science session is labelled Science Lab, not Math Dojo', 'Science Lab · practice' in log)
    ok('the game homework shows with its best score', 'Played · Mathletics Practice' in log and 'Best score 55%' in log)
    page.evaluate("() => document.getElementById('student-hub-overlay').remove()")

    print('7. back on the progress screen: game & skill assignments')
    ok('the progress screen is still there under the hub', page.locator('#cp-body').count() == 1)
    page.click('#cp-body .cp-tab:has-text("Assignments")')
    page.wait_for_selector('#cp-homework .hwb', timeout=5000)
    heads = page.evaluate("() => [...document.querySelectorAll('#cp-homework .hwb-meta')].map(m => m.textContent)")
    ok('the game goal reads "70% and 10 minutes"', 'Goal: 70% and 10 minutes' in heads[0])
    ok('the skill goal reads "Fractions of a Shape to 80%"', 'Goal: Fractions of a Shape to 80%' in heads[1])
    ok('the overdue count is on the batch', '1 overdue' in page.inner_text('#cp-homework .hwb >> nth=0'))
    page.locator('#cp-homework .hwb-head').first.click()
    page.wait_for_timeout(150)
    rows = page.evaluate("() => [...document.querySelectorAll('#cp-homework .hwb')[0].querySelectorAll('tbody tr')].map(r => [...r.children].map(c => c.textContent.trim()))")
    check('overdue first, highlighted', [rows[0][0], rows[0][1]], ['Mara Ozturk', 'Overdue'])
    ok('  the row carries the highlight', page.evaluate("() => document.querySelectorAll('#cp-homework .hwb')[0].querySelector('tbody tr').classList.contains('hw-over')"))
    done = [r for r in rows if r[0].startswith('Mara Okonkwo')][0]
    check('time played as mm:ss, best score, attempts', done[2:5], ['92%', '12:14', '3'])
    ok('a student who left is marked', any('no longer in class' in r[0] for r in rows))
    ok('no sideways page scroll', page.evaluate(NO_HSCROLL))
    shot('7-homework')
    page.evaluate("() => app.closeModal('class-progress')")

    print('8. the same results under the class\'s Assignments')
    page.evaluate("() => app.viewAssignments('c1')")
    page.wait_for_selector('#class-homework-results .hwb', timeout=8000)
    check('both batches listed', page.evaluate("() => document.querySelectorAll('#class-homework-results .hwb').length"), 2)
    shot('8-assignments')
    page.evaluate("() => app.closeModal('view-assignments')")

    print('9. the roster: Student Hub button and last active')
    page.evaluate("() => app.manageStudents('c1')")
    page.wait_for_function("() => [...document.querySelectorAll('.roster-last-active')].some(s => s.textContent)", timeout=8000)
    check('a Student Hub button per student', page.evaluate("() => document.querySelectorAll('#modal-manage-students button[onclick^=\"app.viewStudentDetails\"]').length"), 6)
    la = page.evaluate("() => [...document.querySelectorAll('.roster-last-active')].map(s => s.textContent.trim())")
    ok('last active filled in for everyone', all(x.startswith('• Last active:') for x in la) and len(la) == 6)
    ok('no sideways page scroll', page.evaluate(NO_HSCROLL))
    shot('9-roster')
    page.evaluate("() => app.closeModal('manage-students')")

    print('10. Class Analytics counts only active students')
    page.evaluate("() => app.classAnalytics('c1')")
    page.wait_for_selector('#modal-analytics', timeout=5000)
    txt = page.inner_text('#modal-analytics')
    ok('6 active, the two withdrawn not counted', '6\nActive students · 2 withdrawn' in txt or ('Active students · 2 withdrawn' in txt and '\n6\n' in txt))
    page.evaluate("() => app.closeModal('analytics')")

    real = [e for e in errors if not any(w in e.lower() for w in ('supabase', 'fetch', 'network', 'google', 'quill'))]
    check('no page errors', real, [])
    browser.close()


with sync_playwright() as pw:
    journey(pw, 420, 900, 'phone')
    journey(pw, 1366, 900, 'desktop')

print(f'\n{passed} passed, {failed} failed   (screenshots: {OUT})')
sys.exit(1 if failed else 0)
