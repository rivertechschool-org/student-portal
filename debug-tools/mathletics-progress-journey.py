#!/usr/bin/env python3
# Mathletics progress, played in a real browser.
#
# Reported 2026-10-01: "it doesn't seem to move the bar no matter what you do,
# and it's highly confusing". The bar showed a hidden multi-session confidence
# score; answers were recorded only when a session ended normally. Progress is
# now facts mastered in the range (two quick first-try answers in a row), with
# Bronze / Silver / Gold at 50 / 75 / 90% and Gold unlocking the next range.
#
# This plays it standalone (no portal, nothing saved): answers quickly and
# checks the live count climbs, quitting keeps it, the dashboard bar moves,
# a wrong/slow first try does not count, and Gold opens the next range.
#
# Run:  python -m http.server 8784 &   (repo root)
#       python debug-tools/mathletics-progress-journey.py
import os, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get('MATHLETICS_URL', 'http://localhost:8784/games/mathletics.html')
CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
OUT = os.environ.get('SHOT_DIR', os.environ.get('TEMP', '.'))
fails = 0
def ok(label, cond, extra=''):
    global fails
    print(('  ok   ' if cond else '  FAIL ') + label + (f'  [{extra}]' if extra else ''))
    fails += (0 if cond else 1)

def answer(pg, n, correct=True):
    """Answer n problems on the first try, immediately."""
    for _ in range(n):
        prob = pg.evaluate("() => { const s = window.mathletics.currentSession; return s.problems[s.currentProblemIndex]; }")
        if not prob: break
        pg.fill('#answer-input', str(prob['answer'] if correct else prob['answer'] + 1))
        pg.press('#answer-input', 'Enter')
        if correct:
            pg.wait_for_timeout(850)   # the game's own 800ms pause before the next problem
        else:
            # then put it right, so the game moves on (a retry does not count)
            pg.fill('#answer-input', str(prob['answer'])); pg.press('#answer-input', 'Enter'); pg.wait_for_timeout(850)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)
    pg = b.new_page(viewport={'width': 900, 'height': 1000})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.dismiss())   # "Continue playing?" -> No, quit
    pg.goto(URL)
    pg.wait_for_function("window.mathletics && window.mathletics.studentData", timeout=30000)
    pg.evaluate("""() => { const m = window.mathletics;
        m.studentData.needs_placement = false; m.studentData.session_count = 1;
        m.studentData.current_range = { min: 0, max: 4 }; m.studentData.problem_history = {}; m.studentData.mastery_progress = {};
        m.updateProgressOverview(); m.showMainMenu(); }""")
    t = pg.inner_text('#range-progress')
    ok('the dashboard says what the bar measures', '0 of 15 facts mastered' in t, t[:80])
    ok('  and what to do next', 'more facts for Bronze' in t)
    ok('there is a "How progress works" explanation', pg.locator('#range-explain summary').count() == 1)

    # A wrong first try does not count, even when put right straight after.
    pg.evaluate("window.mathletics.quickStart()"); pg.wait_for_timeout(500)
    answer(pg, 1, correct=False)
    first = pg.evaluate("() => { const f = window.mathletics.studentData.mastery_progress.facts; return Object.values(f).map(x => x.r.join('')); }")
    ok('a wrong first try is recorded as not-yet', first == ['0'], str(first))

    answer(pg, 24)
    live = pg.inner_text('#facts-live')
    n_live = pg.evaluate("window.mathletics.rangeProgress().mastered")
    ok(f'the live count climbs during the session', n_live > 0 and f'{n_live} / 15' in live, live)
    pg.screenshot(path=os.path.join(OUT, 'mathletics-live.png'))

    # Quit from Pause: progress is kept.
    pg.evaluate("window.mathletics.pauseGame()"); pg.wait_for_timeout(500)
    t = pg.inner_text('#range-progress')
    ok('quitting keeps the facts mastered', f'{n_live} of 15 facts mastered' in t, t[:60])
    w = pg.evaluate("() => document.querySelector('#range-progress .progress-fill').style.width")
    ok(f'the dashboard bar has moved ({w})', w not in ('0%', ''))
    pg.screenshot(path=os.path.join(OUT, 'mathletics-dashboard.png'))

    # Keep going until Gold, then finish the session: next range unlocks.
    pg.evaluate("window.mathletics.quickStart()"); pg.wait_for_timeout(500)
    for _ in range(8):
        if pg.evaluate("window.mathletics.rangeProgress().pct") >= 90: break
        answer(pg, 10)
    pct = pg.evaluate("window.mathletics.rangeProgress().pct")
    ok(f'enough quick answers reach Gold ({pct}%)', pct >= 90)
    pg.evaluate("window.mathletics.endSession('time_up')"); pg.wait_for_timeout(800)
    res = pg.inner_text('#mastery-progress')
    ok('the results say Gold and the new range', 'Gold!' in res and '0–5' in res, res[:120])
    ok('  and list the facts mastered this session', 'new fact' in res)
    rng = pg.evaluate("window.mathletics.studentData.current_range")
    ok(f'the range really moved to 0-5', rng == {'min': 0, 'max': 5}, str(rng))
    after = pg.evaluate("window.mathletics.rangeProgress()")
    ok(f'the new range keeps the facts already mastered ({after["mastered"]} of {after["total"]})',
       after['total'] == 21 and after['mastered'] >= 13)
    pg.screenshot(path=os.path.join(OUT, 'mathletics-results.png'))

    # Detailed progress uses the same words and colours.
    pg.evaluate("window.mathletics.showDetailedProgress()"); pg.wait_for_timeout(400)
    d = pg.inner_text('#mastery-breakdown')
    ok('detailed progress shows the same measure', 'facts mastered' in d and 'Confidence' not in d, d[:80])

    ok('no page errors', not errs, '; '.join(errs[:2]))
    b.close()
print('FAILS:', fails); sys.exit(1 if fails else 0)
