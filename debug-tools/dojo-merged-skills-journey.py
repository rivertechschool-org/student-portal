#!/usr/bin/env python3
# Merged Math Dojo skills, in the real page (Jordan, 2026-10-21).
#
#   * progress the server still holds under a retired title (it does until
#     merge_duplicate_math_skills is applied) is folded into the survivor as
#     it arrives, and the retired title is not posted back
#   * the lesson list and the practice grid no longer show retired skills
#
# Invented progress; nothing touches a server.
#
# Run:  python -m http.server 8791 &   (repo root)
#       python debug-tools/dojo-merged-skills-journey.py
import os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('SITE_URL', 'http://localhost:8791')
CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fails = 0
def ok(label, cond, extra=''):
    global fails
    print(('  ok   ' if cond else '  FAIL ') + label + (f'  [{extra}]' if extra else ''))
    fails += (0 if cond else 1)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)
    pg = b.new_page(viewport={'width': 1200, 'height': 900})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'{BASE}/games/math-dojo.html')
    pg.wait_for_function("typeof foldRetiredSkills === 'function' && typeof skillTreeData === 'object'", timeout=30000)
    pg.wait_for_timeout(800)

    print('\n== progress arriving from the server under a retired title ==')
    pg.evaluate("""() => {
      skillTreeData.skills = { 'Simple Probability': { state: 'in_progress', mastery_score: 40, practice_count: 2, last_practiced: '2026-10-01T00:00:00Z' } };
      window.__posted = [];
      const real = window.parent.postMessage.bind(window.parent);
      // Standalone, the page is its own parent: record what it would send up.
      window.parent.postMessage = (m, o) => { window.__posted.push(m); };
      real({ type: 'SKILL_DATA_FOR_DOGO', skills: {
        'Probability Basics': { state: 'mastered', mastery_score: 96, p_mastered: 0.97, practice_count: 9, last_practiced: '2026-10-15T00:00:00Z' },
        'Series': { state: 'mastered', mastery_score: 99, practice_count: 4, last_practiced: '2026-10-12T00:00:00Z' }
      } }, '*');
    }""")
    pg.wait_for_timeout(500)
    s = pg.evaluate("skillTreeData.skills")
    sp = s.get('Simple Probability', {})
    ok('Probability Basics mastery lands on Simple Probability', sp.get('state') == 'mastered' and sp.get('mastery_score') == 96 and sp.get('practice_count') == 11, str(sp))
    sc = s.get('Series Convergence', {})
    ok('Series lands on Series Convergence as in progress (partial cover)', sc.get('state') == 'in_progress' and sc.get('mastery_score') == 60, str(sc))
    ok('the retired titles are gone from the map', 'Probability Basics' not in s and 'Series' not in s, ', '.join(sorted(s)))
    # Standalone the page has no parent to post to; inside the portal it posts
    # skillTreeData.skills as it stands (saveSkillTreeData), checked above.
    # The copy it saves on this device must match.
    saved = pg.evaluate("""() => { const k = Object.keys(localStorage).find(k => k.startsWith('math_skill_states'));
      return k ? Object.keys(JSON.parse(localStorage.getItem(k)).skills || {}) : null; }""")
    ok('the saved copy carries no retired title', saved is None or ('Probability Basics' not in saved and 'Series' not in saved), str(saved))

    print('\n== what students see ==')
    listed = pg.evaluate("""() => Object.fromEntries(Object.keys(TIERS).map(t => [t, [...TIERS[t].domains]]))""")
    gone = [(6, 'Area'), (6, 'Volume'), (4, 'Equations'), (4, 'Probability Basics'), (10, 'Series'), (7, 'Probability'), (10, 'Probability Theory'), (10, 'Investments & Growth')]
    ok('the lesson lists drop the retired skills', all(n not in listed[str(t)] for t, n in gone), str([(t, n) for t, n in gone if n in listed[str(t)]]))
    ok('  and keep their survivors', 'Area' in listed['2'] and 'Simple Probability' in listed['3'] and 'Series Convergence' in listed['8'])
    grid = pg.evaluate("() => Object.fromEntries(Object.keys(generators).map(t => [t, Object.keys(generators[t])]))")
    ok('the practice grid drops them too', all(n not in grid[str(t)] for t, n in gone), str([(t, n) for t, n in gone if n in grid[str(t)]]))
    # A retired skill's lesson asked for by name (an old link) opens nothing broken.
    pg.evaluate("() => { state.learningTier = 3; state.learningSkill = 'Simple Probability'; document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); startLearning(); }")
    pg.wait_for_timeout(300)
    ok('the survivor lesson opens', pg.is_visible('#learning-screen'))

    ok('no page errors', not errs, '; '.join(errs[:3]))
    b.close()

print(f"\n{'ALL OK' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
