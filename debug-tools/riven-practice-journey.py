# Riven practice journey: a teacher asking where their students are.
#
# Opens the real portal page in a browser, signs in as a teacher against a
# stubbed database, opens Riven from the launcher, and TYPES the questions a
# teacher asks - "what is X stuck on", "who hasn't practised this week", "how
# did Math do on ..." - into the box, pressing Enter like a person. Then it
# reads the answer bubble Riven drew and checks it says the right thing.
#
# The unit tests (tests/riven-practice.test.js) hold each executor honest;
# this holds the SEAM honest: typed text -> intent -> executor -> RPC -> bubble,
# with the page's own normaliser, name matcher and renderer in the path.
#
#   python -m http.server 8783 &          (from the repo root)
#   python debug-tools/riven-practice-journey.py
#
# Needs Python Playwright. Uses installed Chrome; set RIVEN_CHROME to another
# Chromium binary, RIVEN_URL to serve from elsewhere.
#
# EVERY NAME BELOW IS INVENTED, deliberately awkward (surnames one edit from
# "stuck", "dojo", "played"; a shared first name). No real record is read.
import asyncio, os, sys, json, datetime
from playwright.async_api import async_playwright


def _due(days_ago):
    """'Sep 28' for a date `days_ago` days back, as the page prints it."""
    d = datetime.date.today() - datetime.timedelta(days=days_ago)
    return f'{d:%b} {d.day}'

URL = os.environ.get('RIVEN_URL', 'http://localhost:8783/portal/index.html')
CHROME = os.environ.get('RIVEN_CHROME', 'C:/Program Files/Google/Chrome/Application/chrome.exe')

BOOT_JS = r"""
() => {
  const DAY = 86400000;
  const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
  const dateAgo = (d) => { const x = new Date(Date.now() - d * DAY);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const P = [
    { id: 's1', first_name: 'Masterson', last_name: 'Stucky' },
    { id: 's2', first_name: 'Gamelin', last_name: 'Dorjo' },
    { id: 's3', first_name: 'Fadia', last_name: 'Player' },
    { id: 's4', first_name: 'Marlowe', last_name: 'Brook' },
    { id: 's5', first_name: 'Marlowe', last_name: 'Tenley' },
  ];
  const cls = [{ id: 'c1', name: 'Invented Math' }];
  const row = (p, x) => ({ ...p, grade_level: 5, last_active: null, active_in_window: false, sessions_7d: 0,
    questions_7d: 0, correct_7d: 0, minutes_7d: 0, mastered: 0, stuck: 0, fading: 0, mastered_30d: 0,
    stuck_skills: [], classes: cls, homework_overdue: [], ...x });
  const overview = { since: dateAgo(7), students: [
    row(P[0], { last_active: ago(3), sessions_7d: 2, questions_7d: 40, correct_7d: 30, minutes_7d: 25, mastered: 2, stuck: 2, fading: 1, mastered_30d: 1,
      stuck_skills: [{ subject: 'Math', skill: 'Long Division', mastery: 42, practices: 7 }, { subject: 'Reading', skill: 'Main Idea', mastery: 51, practices: 5 }],
      homework_overdue: [{ id: 'h1', title: 'Multiplication Facts', type: 'game', due_date: dateAgo(2), best_score: null }] }),
    row(P[1], { last_active: ago(10), stuck: 1, stuck_skills: [{ subject: 'Math', skill: 'Long Division', mastery: 55, practices: 4 }] }),
    row(P[2], { last_active: ago(1), sessions_7d: 4, stuck: 1, stuck_skills: [{ subject: 'Math', skill: 'Adding Fractions', mastery: 30, practices: 9 }],
      homework_overdue: [{ id: 'h2', title: 'Multiplication Facts', type: 'game', due_date: dateAgo(2), best_score: 40 }] }),
    row(P[3], { last_active: null }),
    row(P[4], { last_active: ago(0.1), sessions_7d: 6, mastered: 9 }),
  ] };
  const classProgress = { class: { id: 'c1', name: 'Invented Math' }, subjects: [], students: overview.students, skills: [
    { student_id: 's1', subject: 'Math', skill: 'Long Division', state: 'learning', mastery: 42, practices: 7, last: ago(3), flag: 'stuck' },
    { student_id: 's1', subject: 'Math', skill: 'Times Tables', state: 'mastered', mastery: 92, practices: 12, last: ago(3), mastered_at: ago(4), flag: null },
    { student_id: 's1', subject: 'Math', skill: 'Place Value', state: 'mastered', mastery: 95, practices: 9, last: ago(45), mastered_at: ago(80), flag: 'fading' },
    { student_id: 's1', subject: 'Reading', skill: 'Main Idea', state: 'learning', mastery: 51, practices: 5, last: ago(3), flag: 'stuck' },
    { student_id: 's2', subject: 'Math', skill: 'Long Division', state: 'learning', mastery: 55, practices: 4, last: ago(10), flag: 'stuck' },
    { student_id: 's3', subject: 'Math', skill: 'Adding Fractions', state: 'learning', mastery: 30, practices: 9, last: ago(1), flag: 'stuck' },
    { student_id: 's5', subject: 'Math', skill: 'Place Value', state: 'mastered', mastery: 99, practices: 3, last: ago(0.1), flag: null },
  ] };
  const homework = [
    { key: 'k1', title: 'Multiplication Facts', type: 'game', game_id: 'math-dojo', subject: 'Math', due_date: dateAgo(2),
      assigned: 5, completed: 2, started: 1, overdue: 2, students: [
        { student_id: 's1', first_name: 'Masterson', last_name: 'Stucky', status: 'assigned', overdue: true },
        { student_id: 's2', first_name: 'Gamelin', last_name: 'Dorjo', status: 'completed', best_score: 61, completed_at: ago(3) },
        { student_id: 's3', first_name: 'Fadia', last_name: 'Player', status: 'in_progress', best_score: 40, play_seconds: 360, attempts: 2, overdue: true },
        { student_id: 's4', first_name: 'Marlowe', last_name: 'Brook', status: 'completed', best_score: 94, completed_at: ago(3) },
        { student_id: 's5', first_name: 'Marlowe', last_name: 'Tenley', status: 'excused' },
      ] },
  ];
  const T = {
    homework_assignments: [
      { id: 'h1', title: 'Multiplication Facts', subject: 'Math', assignment_type: 'game', due_date: dateAgo(2), status: 'assigned', student_id: 's1', class_id: 'c1' },
      { id: 'h3', title: 'Fractions', subject: 'Math', assignment_type: 'skill_mastery', due_date: dateAgo(1), status: 'completed', best_score: 88, completed_at: ago(1), student_id: 's1', class_id: 'c1' },
    ],
    class_enrollments: P.map(p => ({ id: 'e' + p.id, class_id: 'c1', student_id: p.id, status: 'active' })),
  };
  window.__rpc = [];
  window.__progressOpened = [];
  const build = (tb) => {
    const f = [];
    const api = new Proxy({}, { get(_, k) {
      if (k === 'then') return (res, rej) => {
        const rows = (T[tb] || []).filter(r => f.every(([c, v, how]) => how === 'in' ? v.includes(r[c]) : (r[c] ?? null) === v));
        return Promise.resolve({ data: JSON.parse(JSON.stringify(rows)), error: null }).then(res, rej);
      };
      if (k === 'eq') return (c, v) => { f.push([c, v]); return api; };
      if (k === 'in') return (c, v) => { f.push([c, v, 'in']); return api; };
      if (k === 'single' || k === 'maybeSingle') return () => ({ then: (res) => res({ data: null, error: null }) });
      return () => api;
    } });
    return api;
  };
  app.auth.supabase = {
    from: build,
    rpc: (fn, args) => {
      window.__rpc.push([fn, args]);
      const data = fn === 'rt_teacher_progress_overview' ? overview
        : fn === 'rt_class_progress' ? classProgress
        : fn === 'rt_class_homework' ? homework : null;
      return Promise.resolve({ data: JSON.parse(JSON.stringify(data)), error: null });
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  };
  app.userInfo = { user: { id: 'u-t' }, profile: { id: 'u-t', user_type: 'teacher', first_name: 'Test' } };
  app.showNotification = () => {};
  // The class progress screen is being built alongside; a stub proves the
  // button reaches it with the right class.
  app.showClassProgress = (id) => { window.__progressOpened.push(id); };
  app._terminalAllStudents = P.map(p => ({ ...p, full_name: `${p.first_name} ${p.last_name}`, email: p.first_name.toLowerCase() + '@x.test', rtc_balance: 0, status: 'active', account_status: 'activated' }));
  app._terminalAllClasses = [{ id: 'c1', name: 'Invented Math', subject: 'Math', teacher_id: 'u-t', secondary_teacher_id: null, is_active: true, status: 'active' }];
  app._terminalGradeBands = []; app._terminalAllGroups = []; app._terminalStoreItems = []; app._terminalPrivileges = [];
  app._rivenMyStudentIdSet = new Set(P.map(p => p.id));
  app._rivenReadyPromise = Promise.resolve();
  try { localStorage.setItem('riven_briefing_at_u-t', String(Date.now())); } catch (_) {}
  document.getElementById('loading-screen')?.classList.add('hidden');
  document.getElementById('auth-required')?.classList.add('hidden');
  document.getElementById('main-app')?.classList.remove('hidden');
  return app.mountRivenWidget();
}
"""

LAST_ANSWER_JS = """() => { const b = [...document.querySelectorAll('#terminal-output .riven-msg-riven')];
  return b.length ? b[b.length - 1].innerText.replace(/\\s+/g, ' ').trim() : ''; }"""

# question, things the answer must say, things it must not
JOURNEY = [
    ('what is Masterson stuck on in maths',
     ['Masterson Stucky is stuck on 1 skill in Math', 'Long Division — 42% after 7 practices'], ['Main Idea']),
    ("who hasn't practised this week",
     ['2 of 5 students', 'Marlowe Brook — no practice on record', 'Gamelin Dorjo — last practised 10 days ago'], ['Fadia']),
    ("who hasn't played math dojo this week",
     ['Math Dojo is counted as Math skill practice', 'Marlowe Brook'], []),
    ('who is stuck',
     ['3 of 5 students are stuck', 'Most common: Long Division (2)'], []),
    ('which students are struggling with fractions',
     ['1 of 5 students is stuck on', 'Fadia Player — Adding Fractions 30% after 9'], ['Masterson']),
    ("who hasn't finished the multiplication game",
     ['Multiplication Facts', '2 of 4 finished', 'Masterson Stucky — not started, overdue', 'Fadia Player — started, best 40%, 6 min, overdue'], ['Tenley']),
    ('how did invented math do on the multiplication facts',
     ['average 78%', 'Lowest scores: Gamelin Dorjo 61%'], ['Brook 94%']),
    ('what has Masterson mastered this month',
     ['mastered 1 skill in the last 30 days', 'Times Tables'], ['Place Value —']),
    ('how is Gamelin doing',
     ['the top items need attention', 'Practice', 'last active 10 days ago', 'stuck on Long Division (55%, 4 tries)'], ['looks steady']),
    # The due date is the day it was set for: a bare date used to be read as
    # UTC midnight and shown a day early.
    ('what homework does Masterson have',
     ['Overdue', 'Done · 88%', '1 overdue · 1 finished in the last 2 weeks',
      'Multiplication Facts Due ' + _due(2)], []),
    ('briefing',
     ["2 students haven't practised in 7 days", '3 students are stuck', 'Overdue game/skill work: Multiplication Facts — 2 students'], []),
]


async def main():
    ok = bad = 0
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)
        page = await browser.new_page(viewport={'width': 1300, 'height': 900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL)
        await page.wait_for_function('() => window.app && window.app.auth', timeout=20000)
        await page.evaluate(BOOT_JS)
        await page.wait_for_timeout(300)
        build = await page.evaluate("() => document.querySelector('.riven-build')?.textContent || ''")
        print('Riven', build)
        await page.click('#riven-launcher')
        await page.wait_for_timeout(300)
        for q, must, mustnt in JOURNEY:
            before = await page.evaluate("() => document.querySelectorAll('#terminal-output .riven-msg-riven').length")
            await page.fill('#terminal-input', q)
            await page.press('#terminal-input', 'Enter')
            # wait for the answer bubble, not the "Checking..." line
            for _ in range(40):
                await page.wait_for_timeout(150)
                n = await page.evaluate("() => document.querySelectorAll('#terminal-output .riven-msg-riven').length")
                ans = await page.evaluate(LAST_ANSWER_JS)
                if n > before and not ans.endswith('…'):
                    break
            ans = await page.evaluate(LAST_ANSWER_JS)
            missing = [m for m in must if m not in ans]
            wrong = [m for m in mustnt if m in ans]
            good = not missing and not wrong
            ok += good; bad += (not good)
            print(f"\n{'ok  ' if good else 'FAIL'} > {q}\n     {ans[:600]}")
            for m in missing: print(f'     MISSING: {m}')
            for m in wrong: print(f'     SHOULD NOT SAY: {m}')
        # The progress button opens that class.
        btn = page.locator('#terminal-output button', has_text='progress').last
        if await btn.count():
            await btn.click()
            opened = await page.evaluate('() => window.__progressOpened')
            good = opened == ['c1']
            ok += good; bad += (not good)
            print(f"\n{'ok  ' if good else 'FAIL'} the progress button opens class c1 (got {opened})")
        else:
            bad += 1; print('\nFAIL no progress button was offered')
        rpcs = await page.evaluate('() => window.__rpc.map(r => r[0])')
        print('\nRPCs called:', ', '.join(sorted(set(rpcs))))
        if errors:
            bad += 1
            print('\nPAGE ERRORS:'); [print('  ', e) for e in errors]
        await browser.close()
    print(f'\n{ok} pass, {bad} fail')
    sys.exit(1 if bad else 0)

asyncio.run(main())
