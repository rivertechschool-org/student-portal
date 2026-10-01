"""Browser journeys for recorded learning progress (games side).

Two journeys, both in real Chrome against this checkout:

  1. SHARED DEVICE. Two invented students open Math Dojo, one after the other,
     in the same browser profile (same localStorage). The second must not see
     the first's progress, and nothing the Dojo sends its host may carry the
     first student's skills under the second's name. The device starts dirty:
     the legacy shared keys hold a third student's "mastery", as an old build
     would have left them.

  2. GRIDFALL SAVES. With the host slow, then failing, Terminal Quest must
     never send a save (that would overwrite the real one), and must only say
     "saved" after the host confirms.

  3. SKILL TREE. "Start This Skill" reports intent (in_progress), never
     mastery; override codes work for staff only and the expected code is
     never logged.

  4. HOMEWORK SUMMARIES. Every assignable game is opened as homework
     (?homework=<id>&subject=...&userId=...), one session is played to its end
     through the game's own start/end code, and the host must receive exactly
     the GAME_SESSION_SUMMARY shape with that homework id.

The host is a stand-in page served at this origin (Playwright route, nothing
written to the repo): an iframe plus a message log, answering the Dojo's
startup request with invented server progress. No Supabase, no real records.

Run (port 8781 only - 8765 is a production service on this machine):
    python -m http.server 8781          # from the repo root, in another shell
    python debug-tools/progress-journeys.py
"""
import json
import sys
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8781'
CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

HOST_HTML = """<!doctype html><meta charset="utf-8"><title>journey host</title>
<body style="margin:0"><iframe id="g" style="width:1200px;height:800px;border:0"></iframe>
<script>
window.__msgs = [];
window.__server = {};   // skills the "database" holds for the student, by subject
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || !e.data.type) return;
  window.__msgs.push(JSON.parse(JSON.stringify(e.data)));
  const t = e.data.type;
  if (t === 'DOGO_REQUEST_SKILL_DATA') {
    e.source.postMessage({ type: 'SKILL_DATA_FOR_DOGO', subject: e.data.subject || 'Math',
      skills: window.__server[e.data.subject || 'Math'] || {} }, '*');
  } else if (t === 'REQUEST_SKILL_DATA') {
    e.source.postMessage({ type: 'SKILL_DATA_RESPONSE', subject: e.data.subject,
      progress: window.__server[e.data.subject] || {}, skillTreeData: {} }, '*');
  } else if (t === 'DOGO_REQUEST_WEEKLY_MASTERIES') {
    e.source.postMessage({ type: 'WEEKLY_MASTERIES_FOR_DOGO', skills: [] }, '*');
  }
});
window.openGame = (src) => { window.__msgs = []; document.getElementById('g').src = src; };
</script></body>"""

results = []


def check(label, cond, detail=''):
    results.append((label, bool(cond)))
    print(('pass  ' if cond else '  FAIL  ') + label + ('' if cond else '\n        ' + str(detail)))


def open_game(page, src):
    page.evaluate('(src) => window.openGame(src)', src)
    page.wait_for_function("() => { const f = document.getElementById('g'); "
                           "return f.contentDocument && f.contentDocument.readyState === 'complete' "
                           "&& f.contentWindow.location.href !== 'about:blank'; }", timeout=30000)
    page.wait_for_timeout(1500)   # startup handshakes
    return page.frame_locator('#g'), page.frames[1]


def msgs(page, type_=None):
    m = page.evaluate('() => window.__msgs')
    return [x for x in m if type_ is None or x.get('type') == type_]


def journey_shared_device(page):
    # Old-build leftovers on this browser: a third student's mastery under the
    # shared keys, and a guest map that claims to be newer than anything.
    page.evaluate("""() => {
        localStorage.clear();
        localStorage.setItem('math_skill_states', JSON.stringify({ skills: {
            'Long Division': { state: 'mastered', mastery_score: 100 } }, lastSync: 1 }));
        localStorage.setItem('math_skill_progress_guest', JSON.stringify({ skills: {
            'Ratios and Rates': { state: 'mastered', mastery_score: 100 } }, lastSync: 9e15 }));
        localStorage.setItem('current_user_id', 'prof-leftover');
    }""")

    # Student A: Ines. Her server copy has two skills.
    page.evaluate("""() => { window.__server = { Math: {
        'Counting to 20': { state: 'mastered', mastery_score: 100, last_practiced: '2026-09-20T10:00:00Z' },
        'Number Bonds': { state: 'in_progress', mastery_score: 45, last_practiced: '2026-09-21T10:00:00Z' } } }; }""")
    _, frame = open_game(page, '/games/math-dojo.html?userId=prof-ines-demo')
    a_skills = frame.evaluate('() => Object.keys(skillTreeData.skills).sort()')
    check('student A sees her own server skills', a_skills == ['Counting to 20', 'Number Bonds'], a_skills)
    check('student A does not see the legacy shared-key skills',
          'Long Division' not in a_skills and 'Ratios and Rates' not in a_skills, a_skills)
    a_updates = msgs(page, 'DOJO_SKILL_DATA_UPDATED')
    check('every Dojo map A sends is tagged with her id',
          a_updates and all(u.get('owner') == 'prof-ines-demo' for u in a_updates), a_updates)
    # Ines practises: a real session through the Dojo's own tracking code.
    frame.evaluate("""() => { startSessionTracking('testing');
        recordQuestionResult('Number Bonds', 1, true, 1200);
        recordQuestionResult('Number Bonds', 1, true, 1100);
        endSessionTracking({ promote: false }); }""")
    stored = page.evaluate("() => JSON.parse(localStorage.getItem('math_skill_states_prof-ines-demo') || 'null')")
    check("A's progress is stored under her own key with owner = her id",
          stored and stored.get('owner') == 'prof-ines-demo', stored and stored.get('owner'))

    # Student B: Tobi, same browser profile, nothing on the server yet.
    page.evaluate('() => { window.__server = { Math: {} }; }')
    _, frame = open_game(page, '/games/math-dojo.html?userId=prof-tobi-demo')
    b_skills = frame.evaluate('() => Object.keys(skillTreeData.skills)')
    check("student B on the same browser sees none of A's progress", b_skills == [], b_skills)
    # B plays one question; whatever B's Dojo sends must be B's alone.
    frame.evaluate("""() => { startSessionTracking('testing');
        recordQuestionResult('Skip Counting', 1, false, 2000);
        endSessionTracking({ promote: false }); }""")
    b_updates = msgs(page, 'DOJO_SKILL_DATA_UPDATED')
    leaked = sorted({k for u in b_updates for k in (u.get('skills') or {})
                     if k in ('Counting to 20', 'Number Bonds', 'Long Division', 'Ratios and Rates')})
    check("nothing B's Dojo sends the host carries A's (or the leftovers') skills", not leaked, leaked)
    check("B's maps are tagged with B's id", b_updates and all(u.get('owner') == 'prof-tobi-demo' for u in b_updates),
          [u.get('owner') for u in b_updates])

    # A comes back: her progress is still hers.
    page.evaluate("() => { window.__server = { Math: {} }; }")
    _, frame = open_game(page, '/games/math-dojo.html?userId=prof-ines-demo')
    again = frame.evaluate('() => Object.keys(skillTreeData.skills).sort()')
    check('student A gets her local progress back on her next visit', 'Number Bonds' in again, again)

    # Embedded with no id (a host that forgot to pass one): no local reads.
    _, frame = open_game(page, '/games/math-dojo.html')
    anon = frame.evaluate('() => Object.keys(skillTreeData.skills)')
    check('embedded with no id: no one\'s local progress is loaded', anon == [], anon)


def journey_gridfall(page):
    """A slow or failed load must never let GRIDFALL overwrite the cloud save."""
    # This host does NOT answer TQ_LOAD: the database is "slow".
    _, frame = open_game(page, '/games/terminal-quest.html?userId=prof-ines-demo')
    frame.evaluate("() => { TQ._exec('ls'); TQ._exec('mkdir workshop'); }")   # play: makes the game dirty
    page.wait_for_timeout(9000)    # past the first 3.5s timeout and a 4s autosave
    loads = len(msgs(page, 'TQ_LOAD'))
    saves = msgs(page, 'TQ_SAVE')
    check('GRIDFALL: no answer to TQ_LOAD -> it retries', loads >= 2, loads)
    check('GRIDFALL: no answer to TQ_LOAD -> no TQ_SAVE is ever sent', not saves, len(saves))
    check('GRIDFALL: the student is told it is not saving',
          'not saving' in frame.evaluate("() => (document.getElementById('sb-save')||{}).textContent || ''"))

    # The host answers, but the read failed: still no save.
    page.evaluate("""() => document.getElementById('g').contentWindow.postMessage(
        { type: 'TQ_SAVE_DATA', save: null, projects: [], loadFailed: true, error: 'timeout' }, location.origin)""")
    frame.evaluate("() => TQ._exec('ls')")
    page.wait_for_timeout(5000)
    check('GRIDFALL: loadFailed:true -> still no TQ_SAVE', not msgs(page, 'TQ_SAVE'))

    # A real "no save yet": now saving is allowed, and "saved" waits for the ack.
    page.evaluate("""() => document.getElementById('g').contentWindow.postMessage(
        { type: 'TQ_SAVE_DATA', save: null, projects: [], loadFailed: false }, location.origin)""")
    frame.evaluate("() => TQ._exec('ls')")
    page.wait_for_timeout(5000)
    saves = msgs(page, 'TQ_SAVE')
    status = frame.evaluate("() => document.getElementById('sb-save').textContent")
    check('GRIDFALL: after a successful load the autosave goes out', len(saves) >= 1, len(saves))
    check('GRIDFALL: "saved" is not shown before the host confirms', 'saved' not in status.replace('unsaved', ''), status)
    seq = saves[-1].get('seq') if saves else None
    page.evaluate("""(seq) => document.getElementById('g').contentWindow.postMessage(
        { type: 'TQ_SAVED', ok: true, error: null, seq }, location.origin)""", seq)
    page.wait_for_timeout(300)
    status = frame.evaluate("() => document.getElementById('sb-save').textContent")
    check('GRIDFALL: "saved" shows once the host confirms', 'saved' in status, status)


def journey_skill_tree(page, console_lines):
    """A tree click is intent, never mastery; override codes are staff-only."""
    for who, user_type in (('student', 'student'), ('teacher', 'teacher')):
        console_lines.clear()
        _, frame = open_game(page, f'/SkillTreeViewer.html?subject=Science&userId=prof-ines-demo&userType={user_type}')
        page.wait_for_timeout(1500)
        name = frame.evaluate("""() => { const m = window.skillTreeManager;
            const n = Object.keys(m.SKILL_TREE).find(k => m.SKILL_TREE[k].state === 'available');
            if (n) m.activateSkill(n); return n || null; }""")
        if who == 'student':
            unlocked = msgs(page, 'SKILL_UNLOCKED')
            check('tree: "Start This Skill" tells the host in_progress, never mastered/activated',
                  name and unlocked and all(u.get('state') == 'in_progress' for u in unlocked), unlocked)
            check('tree: the node shows In Progress, not Mastered',
                  frame.evaluate('(n) => window.skillTreeManager.SKILL_TREE[n].state', name) == 'in_progress')
        # Try the override codes.
        res = frame.evaluate("""() => { const m = window.skillTreeManager;
            const before = JSON.stringify(Object.values(m.SKILL_TREE).map(s => s.state));
            m.showOverrideModal(Object.keys(m.SKILL_TREE)[0]);
            document.getElementById('overrideCodeInput').value = 'UNLOCKALL';
            m.validateAndUnlock();
            const after = JSON.stringify(Object.values(m.SKILL_TREE).map(s => s.state));
            return { changed: before !== after, err: document.getElementById('overrideError').textContent }; }""")
        if who == 'student':
            check('tree: a student cannot use UNLOCKALL', not res['changed'], res)
        else:
            check('tree: staff can use UNLOCKALL', res['changed'], res)
        frame.evaluate("""() => { const m = window.skillTreeManager;
            m.showOverrideModal(Object.keys(m.SKILL_TREE)[0]);
            document.getElementById('overrideCodeInput').value = '0000';
            m.validateAndUnlock(); }""")
        code = frame.evaluate('() => window.skillTreeManager.generateOverrideCode()')
        leaked = [l for l in console_lines if code in l and 'xpected' in l]
        check(f'tree ({who}): the expected override code is never logged', not leaked, leaked)


# Per game: the URL, and JS (run inside the game) that starts one session and
# ends it through the game's own code. Where the game has a UI-only path, the
# driver clicks it.
SUBJECT_GAME = """() => { const sk = Object.keys(GENERATORS)[0];
    startSession('desk', [sk], 1); endSession(); }"""
GAMES = [
    ('math-dojo', '/games/math-dojo.html', 'Math', """() => { startSessionTracking('testing');
        recordQuestionResult('Counting', 1, true, 900); recordQuestionResult('Counting', 1, false, 900);
        endSessionTracking({ promote: false }); }"""),
    ('english-lyceum', '/games/english-lyceum.html', 'Reading', SUBJECT_GAME),
    ('science-lab', '/games/science-lab.html', 'Science', SUBJECT_GAME),
    ('social-studies', '/games/social-studies.html', 'Social', SUBJECT_GAME),
    ('art-studio', '/games/art-studio.html', 'Creative', SUBJECT_GAME),
    ('life-skills', '/games/life-skills.html', 'LifeSkills', SUBJECT_GAME),
    ('bible-study', '/games/bible-study.html', 'Bible', SUBJECT_GAME),
    ('mathletics', '/games/mathletics.html', 'Math', """() => { window.mathletics.startSession(0, 2, 60, 10, false);
        window.mathletics.reportSessionSummary(); }"""),
    ('mathspire', '/games/mathspire.html', 'Math', """() => { window.game.startWithSeed(424242, 0);
        window.game.reportSessionSummary(false); }"""),
    ('practice-pilot', '/games/practice-pilot.html', 'Math', """() => { startGame(1); restartFromPause(); }"""),
    ('clockwork-defense', '/games/clockwork-defense.html', 'Math', """() => { resetGame(); endGame(); }"""),
    ('dimension-shift', '/games/dimension-shift.html', 'Math', 'CLICK_START_THEN_RESTART'),
    ('wasteland-adventure', '/games/wasteland_adventure.html', 'Math', 'NEW_GAME_THEN_LEAVE'),
]
SHAPE = ['type', 'gameId', 'subject', 'homeworkId', 'score', 'correct', 'total', 'durationSeconds', 'endedAt']


def journey_summaries(page):
    for gid, path, subject, driver in GAMES:
        hw = 'hw-demo-' + gid
        src = f'{path}?homework={hw}&subject={subject}&userId=prof-ines-demo'
        try:
            _, frame = open_game(page, src)
            if driver == 'CLICK_START_THEN_RESTART':
                frame.evaluate("() => document.getElementById('start-button').click()")
                page.wait_for_timeout(800)
                frame.evaluate("() => document.querySelector('.play-again-button').click()")
            elif driver == 'NEW_GAME_THEN_LEAVE':
                frame.evaluate('() => startNewGame()')
                page.wait_for_timeout(500)
                # The host closing the game unloads it: pagehide ends the sitting.
                page.evaluate("() => { document.getElementById('g').src = 'about:blank'; }")
            else:
                frame.evaluate(driver)
            page.wait_for_timeout(700)
        except Exception as e:
            check(f'{gid}: session driven to its end', False, repr(e)[:300])
            continue
        got = msgs(page, 'GAME_SESSION_SUMMARY')
        check(f'{gid}: exactly one GAME_SESSION_SUMMARY for one session', len(got) == 1, got)
        if not got:
            continue
        m = got[0]
        check(f'{gid}: shape', list(m.keys()) == SHAPE, list(m.keys()))
        check(f'{gid}: gameId / homeworkId / subject from the URL',
              (m['gameId'], m['homeworkId'], m['subject']) == (gid, hw, subject),
              (m['gameId'], m['homeworkId'], m['subject']))
        check(f'{gid}: score is an int 0-100 or null; counts are ints',
              (m['score'] is None or (isinstance(m['score'], int) and 0 <= m['score'] <= 100))
              and all(isinstance(m[k], int) and m[k] >= 0 for k in ('correct', 'total', 'durationSeconds')),
              m)
        print(f'        {gid}: score={m["score"]} correct={m["correct"]} total={m["total"]} '
              f'active={m["durationSeconds"]}s')


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True)
        ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
        page = ctx.new_page()
        page.on('dialog', lambda d: d.accept())
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route(BASE + '/__journey_host.html',
                   lambda route: route.fulfill(status=200, content_type='text/html', body=HOST_HTML))
        page.goto(BASE + '/__journey_host.html')
        print('-- journey 1: two students, one browser, Math Dojo')
        journey_shared_device(page)
        print('-- journey 2: GRIDFALL never saves before a load succeeds')
        journey_gridfall(page)
        console_lines = []
        page.on('console', lambda m: console_lines.append(m.text))
        print('-- journey 3: skill tree clicks and override codes')
        journey_skill_tree(page, console_lines)
        print('-- journey 4: every assignable game reports its session')
        journey_summaries(page)
        # Page errors are reported, not failed on: some games log pre-existing
        # ones unrelated to progress. Read them - a new one is a regression.
        for e in errors:
            print('  page error:', e[:200])
        browser.close()
    failed = [l for l, okk in results if not okk]
    print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
