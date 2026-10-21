#!/usr/bin/env python3
# Three Math Dojo skills that were not maths, rebuilt (Jordan, 2026-10-21).
#
#   Mass and Capacity   - "Which is heavier: a feather or an elephant?" became
#                         measuring and calculating with g, kg, mL and L
#   Positional Words    - a word quiz became reading positions off a tower or
#                         a row of shapes
#   Classifying Objects - "Is a bus big or small?" became sorting shapes by
#                         number of sides
#
# This shows each in the real page: a tower question keeps its line breaks
# (question text is pre-line now), and each lesson opens with the steps that
# teach what practice asks. Screenshots go to SHOT_DIR.
#
# Run:  python -m http.server 8784 &   (repo root)
#       python debug-tools/dojo-maths-only-journey.py
import os, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get('DOJO_URL', 'http://localhost:8784/games/math-dojo.html')
CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
OUT = os.environ.get('SHOT_DIR', os.environ.get('TEMP', '.'))
fails = 0
def ok(label, cond, extra=''):
    global fails
    print(('  ok   ' if cond else '  FAIL ') + label + (f'  [{extra}]' if extra else ''))
    fails += (0 if cond else 1)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)
    pg = b.new_page(viewport={'width': 1100, 'height': 900})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_function("typeof generateQuestion === 'function' && typeof renderQuestion === 'function'", timeout=30000)
    pg.wait_for_timeout(800)

    print('\n== a tower question, as a student sees it ==')
    pg.evaluate("""() => {
      let q; do { q = generateQuestion(1, 'Positional Words'); } while (!/top to bottom/.test(q.question));
      q.tier = 1; q.domain = 'Positional Words';
      state.currentQuestion = q; state.mode = 'testing';
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById('test-screen').classList.add('active');
      renderQuestion();
    }""")
    el = pg.locator('#question-text')
    lines = pg.evaluate("() => { const r = document.getElementById('question-text'); return Math.round(r.getBoundingClientRect().height / parseFloat(getComputedStyle(r).lineHeight)); }")
    ok('the tower is drawn one shape per line', lines >= 5, f'{lines} lines: ' + el.inner_text().replace('\n', ' / '))
    pg.screenshot(path=os.path.join(OUT, 'dojo-positional-tower.png'))

    print('\n== the lessons ==')
    for tier, skill, must in [(1, 'Positional Words', ['A tower: top and bottom', 'Between']),
                              (2, 'Mass and Capacity', ['How much heavier? Subtract', 'Equal groups: multiply or divide']),
                              (1, 'Classifying Objects', ['Sort by number of sides'])]:
        pg.evaluate(f"""() => {{
          state.learningTier = {tier}; state.learningSkill = '{skill}';
          document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
          startLearning();
        }}""")
        pg.wait_for_timeout(400)
        txt = pg.inner_text('#learning-screen')
        ok(f'{skill}: lesson opens', pg.is_visible('#learning-screen'))
        ok(f'  and teaches {", ".join(must)}', all(m in txt for m in must), txt[:120].replace('\n', ' '))
        ok('  and says nothing about big/small or which is heavier without numbers',
           'big or small' not in txt and 'feather or' not in txt)
        pg.screenshot(path=os.path.join(OUT, f"dojo-lesson-{skill.replace(' ', '-').lower()}.png"), full_page=True)

    ok('no page errors', not errs, '; '.join(errs[:3]))
    b.close()

print(f"\n{'ALL OK' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
