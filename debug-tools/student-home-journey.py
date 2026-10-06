"""Browser journey for the student Home (root index.html).

A student signs in and lands on Home. Home must tell them how they are doing
and what to do next, from ONE rt_student_overview call, and every button on it
must go somewhere real. Walked in real Chrome against this checkout:

  1. A BUSY WEEK. An invented student with missing work, something due
     tomorrow, a game assignment half done, a skill assignment, a stuck and a
     fading skill, and a class nothing has been marked in yet. Checks the
     order and wording of "Do this next", the links behind its buttons,
     "No grades yet" (never 0.0), week-over-week practice, attendance, the
     How it works panel - and that a Practise button opens the subject's game.
  2. ALL CAUGHT UP. Nothing to do: Home says so instead of drawing an empty
     card.
  3. THE OVERVIEW FAILS. Home says it could not load, and the RTC card and
     calendar (separate loaders) still draw.
  4. AN OLD #grades BOOKMARK lands on Home (the dead Grades tab is gone).

Each one at phone width (420px) and desktop (1280px), checking there is no
sideways page scroll, with a full-page screenshot of each for a human to read.

Supabase is replaced by a stub served in place of shared/supabase.min.js: a
signed-in invented student, empty tables, and the overview fixture below. No
network, no real records. Rows are handed back as copies (JSON round trip),
as a real client would.

Run (port 8785 only - 8765 is a production service on this machine):
    python -m http.server 8785          # from the repo root, in another shell
    python debug-tools/student-home-journey.py [--out DIR]
Screenshots go to DIR (default: a temp folder, printed at the end) - never
into the repo, which is public.
"""
import datetime as dt
import json
import os
import sys
import tempfile
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8785'
CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

OUT = tempfile.mkdtemp(prefix='student-home-')
if '--out' in sys.argv:
    OUT = sys.argv[sys.argv.index('--out') + 1]
    os.makedirs(OUT, exist_ok=True)

NOW = dt.datetime.now().astimezone()


def iso(days=0, hour=15, minute=0):
    """A local time `days` from today, as the database would send it."""
    d = (NOW + dt.timedelta(days=days)).replace(hour=hour, minute=minute, second=0, microsecond=0)
    return d.isoformat()


def day(days=0):
    return (NOW + dt.timedelta(days=days)).date().isoformat()


# The invented student: Wren Calloway, Grade 7. Every name here is made up.
PROFILE = {'id': 'prof-wren-demo', 'auth_user_id': 'auth-wren-demo', 'first_name': 'Wren',
           'last_name': 'Calloway', 'user_type': 'student', 'account_status': 'active',
           'email': 'wren.demo@example.invalid', 'rtc_balance': 140}

BUSY = {
    'success': True,
    'student': {'id': PROFILE['id'], 'first_name': 'Wren', 'last_name': 'Calloway', 'rtc_balance': 140},
    'quarter': {'id': 'q1', 'name': 'Quarter 1', 'start_date': day(-40), 'end_date': day(30)},
    'classes': [
        {'id': 'c-eng', 'name': 'English 7', 'subject': 'Reading', 'class_grade': 88.4, 'academic_grade': 86,
         'participation_grade': 92, 'updated_at': iso(-1), 'graded': 5, 'missing': 0, 'teacher': 'Ms Quill'},
        {'id': 'c-sci', 'name': 'Earth Science', 'subject': 'Science', 'class_grade': 0, 'academic_grade': None,
         'participation_grade': None, 'updated_at': None, 'graded': 0, 'missing': 1, 'teacher': 'Mr Basalt'},
        {'id': 'c-math', 'name': 'Pre-Algebra', 'subject': 'Math', 'class_grade': 76.2, 'academic_grade': 74,
         'participation_grade': 80, 'updated_at': iso(-2), 'graded': 7, 'missing': 1, 'teacher': 'Mrs Abacus'},
        {'id': 'c-pe', 'name': 'PE and Health', 'subject': 'Physical', 'class_grade': 95, 'academic_grade': 95,
         'participation_grade': 95, 'updated_at': iso(-3), 'graded': 2, 'missing': 0, 'teacher': 'Coach Day'},
    ],
    'missing': [
        {'assignment_id': 'a-volc', 'class_id': 'c-sci', 'class_name': 'Earth Science',
         'title': 'Volcano diagram', 'due_at': iso(-2, 23, 59), 'days_overdue': 2},
        {'assignment_id': 'a-ws3', 'class_id': 'c-math', 'class_name': 'Pre-Algebra',
         'title': 'Worksheet 3: integers', 'due_at': iso(-1, 23, 59), 'days_overdue': 1},
    ],
    'due_soon': [
        {'assignment_id': 'a-ch4', 'class_id': 'c-eng', 'class_name': 'English 7', 'title': 'Chapter 4 review',
         'due_at': iso(1, 23, 59), 'handed_in': False, 'offline': False, 'days_left': 1},
    ],
    'practice': [
        {'id': 'h-mathletics', 'type': 'game', 'title': 'Mathletics practice', 'subject': 'Math',
         'game_id': 'mathletics', 'skill_name': None, 'due_date': iso(3), 'status': 'in_progress',
         'min_score': 70, 'min_play_time': 10, 'target': None, 'best_score': 55, 'play_seconds': 372,
         'current_mastery': None, 'overdue': False},
        {'id': 'h-frac', 'type': 'skill_mastery', 'title': 'Fractions push', 'subject': 'Math', 'game_id': None,
         'skill_name': 'Fractions', 'due_date': iso(5), 'status': 'assigned', 'min_score': None,
         'min_play_time': None, 'target': 80, 'best_score': None, 'play_seconds': None,
         'current_mastery': 62, 'overdue': False},
    ],
    'practice_done': [
        {'id': 'h-clock', 'type': 'game', 'title': 'Clockwork Defense: telling time', 'game_id': 'clockwork-defense',
         'skill_name': None, 'final_score': 82, 'play_seconds': 660, 'completed_at': iso(-4)},
    ],
    'skills': {
        'by_subject': [{'subject': 'Math', 'mastered': 12, 'working': 3},
                       {'subject': 'Reading', 'mastered': 5, 'working': 2},
                       {'subject': 'LifeSkills', 'mastered': 1, 'working': 1}],
        'stuck': [{'subject': 'Math', 'skill': 'Long Division', 'mastery': 41, 'practices': 6}],
        'fading': [{'subject': 'Reading', 'skill': 'Parts of Speech', 'last': iso(-45)}],
        'recent_mastered': [{'subject': 'Math', 'skill': 'Equivalent Fractions', 'at': iso(-3), 'source': 'practice'},
                            {'subject': 'Reading', 'skill': 'Context Clues', 'at': iso(-8), 'source': 'practice'}],
        'mastered_this_quarter': 4,
    },
    'week': [
        {'subject': 'Math', 'this_sessions': 4, 'this_questions': 40, 'this_correct': 30, 'this_minutes': 35,
         'last_sessions': 2, 'last_questions': 20, 'last_correct': 18, 'last_minutes': 20},
        {'subject': 'Reading', 'this_sessions': 0, 'this_questions': 0, 'this_correct': 0, 'this_minutes': 0,
         'last_sessions': 1, 'last_questions': 10, 'last_correct': 7, 'last_minutes': 8},
        {'subject': 'Science', 'this_sessions': 1, 'this_questions': 12, 'this_correct': 9, 'this_minutes': 9,
         'last_sessions': 1, 'last_questions': 12, 'last_correct': 9, 'last_minutes': 9},
    ],
    'attendance': {'present': 30, 'late': 2, 'absent': 3, 'absent_excused': 2, 'left_early': 1, 'days': 36,
                   'recent': [{'date': day(-6), 'status': 'absent', 'excused': True},
                              {'date': day(-13), 'status': 'late', 'excused': False}]},
    'planned_absences': [{'start': day(12), 'end': day(14), 'reason': 'Family trip', 'excused': True}],
    # The server's NEXT order: missing (oldest first), due within 2 days,
    # assigned practice, stuck, fading, the rest of the week.
    'next': [
        {'rank': 1, 'kind': 'missing', 'title': 'Volcano diagram', 'detail': 'Earth Science', 'due_at': iso(-2, 23, 59),
         'assignment_id': 'a-volc', 'class_id': 'c-sci'},
        {'rank': 1, 'kind': 'missing', 'title': 'Worksheet 3: integers', 'detail': 'Pre-Algebra',
         'due_at': iso(-1, 23, 59), 'assignment_id': 'a-ws3', 'class_id': 'c-math'},
        {'rank': 2, 'kind': 'due_soon', 'title': 'Chapter 4 review', 'detail': 'English 7', 'due_at': iso(1, 23, 59),
         'assignment_id': 'a-ch4', 'class_id': 'c-eng'},
        {'rank': 3, 'kind': 'game', 'title': 'Mathletics practice', 'detail': 'Goal: 70% and 10 minutes',
         'due_at': iso(3), 'homework_id': 'h-mathletics', 'overdue': False},
        {'rank': 3, 'kind': 'skill', 'title': 'Fractions push', 'detail': 'Goal: Fractions to 80%',
         'due_at': iso(5), 'homework_id': 'h-frac', 'overdue': False},
        {'rank': 4, 'kind': 'stuck', 'title': 'Long Division', 'detail': 'Math · 41% after 6 tries',
         'subject': 'Math', 'skill': 'Long Division'},
        {'rank': 5, 'kind': 'fading', 'title': 'Parts of Speech', 'detail': 'Reading · last practised Aug 18',
         'subject': 'Reading', 'skill': 'Parts of Speech'},
    ],
}

QUIET = {**BUSY, 'classes': BUSY['classes'][:1], 'missing': [], 'due_soon': [], 'practice': [], 'practice_done': [],
         'skills': {'by_subject': [], 'stuck': [], 'fading': [], 'recent_mastered': [], 'mastered_this_quarter': 0},
         'week': [], 'attendance': {'present': 0, 'late': 0, 'absent': 0, 'absent_excused': 0, 'left_early': 0,
                                    'days': 0, 'recent': []},
         'planned_absences': [], 'next': []}

# Stands in for shared/supabase.min.js. window.__overview is the fixture the
# RPC answers with (or {error} to fail it); window.__rpcCalls records calls.
STUB_JS = """
(() => {
  const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
  const USER = { id: 'auth-wren-demo', email: 'wren.demo@example.invalid' };
  const PROFILE = %(profile)s;
  window.__rpcCalls = [];
  // The other loaders on Home read tables directly. Give them the rows the
  // overview implies (Wren's four enrolments), so a disagreement on screen is
  // the page's, not the stub's.
  const rowsFor = (table) => table === 'user_profiles' ? [PROFILE]
    : table === 'class_enrollments' ? %(enrollments)s : [];
  function builder(table) {
    let single = false;
    const b = {
      then(res, rej) {
        const rows = clone(rowsFor(table));
        const data = single ? (rows[0] || null) : rows;
        return Promise.resolve({ data, error: null, count: rows.length }).then(res, rej);
      },
      maybeSingle() { single = true; return b; },
      single() { single = true; return b; }
    };
    ['select','eq','neq','in','is','or','gte','gt','lte','lt','order','limit','range','not','ilike','like',
     'contains','filter','match','insert','update','upsert','delete'].forEach(m => { b[m] = () => b; });
    return b;
  }
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: USER } }, error: null }),
      getUser: async () => ({ data: { user: USER }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      setSession: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: {}, error: null })
    },
    from: (t) => builder(t),
    rpc: async (name, args) => {
      window.__rpcCalls.push({ name, args: args === undefined ? null : clone(args) });
      if (name !== 'rt_student_overview') return { data: null, error: null };
      const ov = window.__overview;
      if (ov && ov.error) return { data: null, error: { message: ov.error } };
      return { data: clone(ov), error: null };
    },
    channel: () => { const c = { on: () => c, subscribe: () => c, unsubscribe() {} }; return c; },
    removeChannel: () => {},
    functions: { invoke: async () => ({ data: null, error: null }) },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) }
  };
  window.supabase = { createClient: () => client };
})();
""" % {'profile': json.dumps(PROFILE),
       'enrollments': json.dumps([{'class_id': c['id'], 'student_id': PROFILE['id'], 'status': 'active'}
                                  for c in BUSY['classes']])}

results = []


def check(label, cond, detail=''):
    results.append((label, bool(cond)))
    print(('pass  ' if cond else '  FAIL  ') + label + ('' if cond else '\n        ' + str(detail)))


def open_home(ctx, overview, hash_=''):
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/shared/supabase.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript',
                                                                body=STUB_JS))
    page.add_init_script('window.__overview = %s;' % json.dumps(overview))
    page.goto(BASE + '/index.html' + hash_)
    page.wait_for_function("() => { const n = document.getElementById('home-next'); "
                           "return n && !/Loading/.test(n.textContent); }", timeout=20000)
    page.wait_for_timeout(600)   # calendar + stats settle
    return page, errors


def no_sideways_scroll(page):
    return page.evaluate('() => document.documentElement.scrollWidth <= window.innerWidth + 1')


def journey_busy(ctx, tag):
    page, errors = open_home(ctx, BUSY)
    calls = page.evaluate('() => window.__rpcCalls.filter(c => c.name === "rt_student_overview")')
    check(f'[{tag}] Home asks for the overview once, for the signed-in student (no argument)',
          len(calls) == 1 and calls[0]['args'] is None, calls)

    rows = page.locator('#home-next .home-row')
    check(f'[{tag}] Do this next shows five items', rows.count() == 5, rows.count())
    kinds = page.eval_on_selector_all('#home-next .home-row', 'els => els.map(e => e.dataset.kind)')
    check(f'[{tag}] in the server\'s order', kinds == ['missing', 'missing', 'due_soon', 'game', 'skill'], kinds)
    first = rows.nth(0).inner_text()
    check(f'[{tag}] overdue work leads, saying how overdue', 'Volcano diagram' in first and '2 days overdue' in first, first)
    check(f'[{tag}] its button hands it in on that assignment',
          rows.nth(0).locator('a').get_attribute('href') == '/portal/?go=assignment&class=c-sci&id=a-volc')
    check(f'[{tag}] tomorrow says "due tomorrow"', 'due tomorrow' in rows.nth(2).inner_text(), rows.nth(2).inner_text())
    check(f'[{tag}] the game assignment opens through the portal (it runs the clock)',
          rows.nth(3).locator('a').get_attribute('href') == '/portal/?go=homework&id=h-mathletics')
    check(f'[{tag}] the rest are counted, not dropped', 'and 2 more' in page.inner_text('#home-next h3'))

    classes = page.inner_text('#home-classes')
    check(f'[{tag}] a class with nothing marked says "No grades yet"', 'No grades yet' in classes, classes)
    check(f'[{tag}] ...and nothing reads 0.0 or 0%', '0.0' not in classes and ' 0%' not in classes, classes)
    check(f'[{tag}] grades show letter and percent', 'B+ · 88.4%' in classes and 'C · 76.2%' in classes, classes)
    check(f'[{tag}] missing work is badged on its class', classes.count('1 missing') == 2, classes)
    check(f'[{tag}] a class opens My Grades for it',
          page.locator('#home-classes a.home-class').first.get_attribute('href') == '/portal/?go=grades&class=c-eng')

    practice = page.inner_text('#home-practice')
    check(f'[{tag}] practice covers every subject (Reading reads as English)',
          all(s in practice for s in ('Math', 'English', 'Science')), practice)
    check(f'[{tag}] the half-done game reads in words', 'Best 55% of 70% · 6 of 10 minutes' in practice, practice)
    check(f'[{tag}] the skill assignment reads in words', 'Fractions 62% of 80%' in practice, practice)
    check(f'[{tag}] week-over-week arrows are drawn', '↑' in practice and '↓' in practice and '=' in practice)
    check(f'[{tag}] finished recently is listed', 'Clockwork Defense' in practice and 'Score 82%' in practice)

    check(f'[{tag}] Skills starts folded', not page.evaluate("() => document.getElementById('home-skills').open"))
    check(f'[{tag}] the folded Skills card still shows its totals',
          'mastered' in page.inner_text('#home-skills summary'), page.inner_text('#home-skills summary'))
    page.click('#home-skills summary')
    skills = page.inner_text('#home-skills')
    check(f'[{tag}] stuck and fading skills are explained', 'stuck: 41% after 6 tries' in skills
          and 'needs a refresh' in skills, skills)

    att = page.inner_text('#home-attendance')
    check(f'[{tag}] attendance this quarter, excused called out', 'Quarter 1' in att and '(2 excused)' in att, att)
    check(f'[{tag}] the planned absence is listed', 'Family trip' in att, att)

    page.click('#home-how summary')
    check(f'[{tag}] How it works opens', page.evaluate("() => document.getElementById('home-how').open"))
    check(f'[{tag}] RTC and the calendar are still on Home',
          page.is_visible('#rtc-balance') and page.locator('#calendar-mount *').count() > 0)
    check(f'[{tag}] "Skills mastered", not "Skills Unlocked"', 'Skills mastered' in page.inner_text('#dashboard-section'))
    counts = [page.inner_text('#skills-mastered'), page.inner_text('#active-classes-count')]
    check(f'[{tag}] the Progress Overview counts agree with the cards under it (18 mastered, 4 classes)',
          counts == ['18', '4'], counts)
    left = page.evaluate("() => document.getElementById('home-next').getBoundingClientRect().left")
    if tag == '420':
        check(f'[{tag}] a 16px gutter on a phone', left == 16, left)
    check(f'[{tag}] no sideways page scroll', no_sideways_scroll(page),
          page.evaluate('() => [document.documentElement.scrollWidth, window.innerWidth]'))
    page.screenshot(path=os.path.join(OUT, f'home-busy-{tag}.png'), full_page=True)

    # The stuck skill's Practise button opens Math Dojo on this site.
    page.locator('#home-skills [data-home-practice="Math"]').first.click()
    page.wait_for_timeout(500)
    src = page.get_attribute('#game-iframe', 'src') or ''
    check(f'[{tag}] Practise on a stuck Math skill opens Math Dojo',
          page.is_visible('#games-section') and 'games/math-dojo.html' in src and 'userId=prof-wren-demo' in src, src)
    check(f'[{tag}] no page errors', not errors, errors)
    page.close()


def journey_quiet(ctx, tag):
    page, errors = open_home(ctx, QUIET)
    nxt = page.inner_text('#home-next')
    check(f'[{tag}] nothing to do -> all caught up, with a suggestion', "You're all caught up" in nxt
          and 'Keep a skill fresh' in nxt, nxt)
    check(f'[{tag}] empty cards say so', 'No practice this week or last' in page.inner_text('#home-practice')
          and 'No attendance recorded yet' in page.inner_text('#home-attendance')
          and 'mastered' in page.inner_text('#home-skills summary'))
    page.click('#home-skills summary')
    check(f'[{tag}] opened, Skills says nothing needs attention', 'Nothing needs attention' in page.inner_text('#home-skills'))
    check(f'[{tag}] no sideways page scroll', no_sideways_scroll(page))
    # The stub still holds four enrolment rows (as if three classes were
    # closed for the year); the overview's count of one must be what shows,
    # whichever loader finishes last.
    page.wait_for_timeout(800)
    check(f'[{tag}] Active Classes agrees with My classes, not the raw enrolment count',
          page.inner_text('#active-classes-count') == '1', page.inner_text('#active-classes-count'))
    page.screenshot(path=os.path.join(OUT, f'home-quiet-{tag}.png'), full_page=True)
    page.click('#home-next [data-home-games]')
    page.wait_for_timeout(300)
    check(f'[{tag}] the caught-up button opens Games', page.is_visible('#games-section'))
    check(f'[{tag}] no page errors', not errors, errors)
    page.close()


def journey_failed(ctx, tag):
    page, errors = open_home(ctx, {'error': 'function rt_student_overview does not exist'})
    nxt = page.inner_text('#home-next')
    check(f'[{tag}] a failed overview says so in words', "couldn't load" in nxt, nxt)
    check(f'[{tag}] ...and hides the cards it could not fill', not page.is_visible('#home-classes'))
    check(f'[{tag}] RTC still draws', page.is_visible('#rtc-balance') and page.inner_text('#rtc-balance') == '140',
          page.inner_text('#rtc-balance'))
    check(f'[{tag}] no page errors', not errors, errors)
    page.close()


def journey_old_bookmark(ctx, tag):
    page, errors = open_home(ctx, BUSY, '#grades')
    check(f'[{tag}] #grades lands on Home', page.is_visible('#dashboard-section')
          and page.evaluate('() => location.hash') == '#dashboard', page.evaluate('() => location.hash'))
    check(f'[{tag}] no page errors', not errors, errors)
    page.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True)
        for tag, vp in (('420', {'width': 420, 'height': 900}), ('1280', {'width': 1280, 'height': 900})):
            ctx = browser.new_context(viewport=vp, device_scale_factor=1)
            journey_busy(ctx, tag)
            journey_quiet(ctx, tag)
            journey_failed(ctx, tag)
            journey_old_bookmark(ctx, tag)
            ctx.close()
        browser.close()
    failed = [l for l, ok in results if not ok]
    print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed')
    print('screenshots: ' + OUT)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
