#!/usr/bin/env python3
# The Graduation Path in the Math Dojo, walked as a student.
#
# What it holds honest (2026-10-04, when the path was added):
#   * the home panel's "X of 65" is what the plan and the student's progress
#     actually say, not a number the page made up
#   * the path screen shows all 65 core items, required, and the four branches
#     set apart (dashed, own colour)
#   * a skill whose prerequisites are mastered opens its lesson from the path;
#     a locked one does not
#   * a branch opens as soon as ITS prerequisites are mastered, without the
#     rest of the core being finished
#   * every skill the plan names has a lesson and a question generator
#   * no sideways scroll on a phone
#
# Progress is invented in the page; nothing touches a server.
#
# Run:  python -m http.server 8791 &   (repo root)
#       python debug-tools/graduation-path-journey.py
import os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('SITE_URL', 'http://localhost:8791')
CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fails = 0
def ok(label, cond, extra=''):
    global fails
    print(('  ok   ' if cond else '  FAIL ') + label + (f'  [{extra}]' if extra else ''))
    fails += (0 if cond else 1)

def fresh(b, w=1280, h=900):
    pg = b.new_page(viewport={'width': w, 'height': h})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'{BASE}/games/math-dojo.html')
    pg.wait_for_function("typeof MATH_PLAN !== 'undefined' && typeof renderGradPathSummary === 'function'", timeout=30000)
    pg.wait_for_timeout(800)
    return pg, errs

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)

    print('\n== the plan itself ==')
    pg, errs = fresh(b)
    r = pg.evaluate("""() => {
      const core = MATH_PLAN.core.domains.flatMap(d => d.items);
      const all = core.concat(MATH_PLAN.branches.flatMap(b => b.domains.flatMap(d => d.items)));
      const ids = [...new Set(all.flatMap(i => i.skills))];
      const unplayable = ids.filter(id => { const n = MATH_GRAPH_V2.nodes[id];
        return !(lessons[n.dt] && lessons[n.dt][n.ds] && generators[n.dt] && generators[n.dt][n.ds]); })
        .map(id => MATH_GRAPH_V2.nodes[id].t);
      return { core: core.length, branches: MATH_PLAN.branches.map(b => b.short), unplayable };
    }""")
    ok('65 core items', r['core'] == 65, r['core'])
    ok('four branches', r['branches'] == ['STEM', 'Business', 'Trades', 'CS & Games'], r['branches'])
    ok('every skill the plan names has a lesson and questions', not r['unplayable'],
       f"{len(r['unplayable'])}: " + ', '.join(r['unplayable'][:12]))

    print('\n== a new student ==')
    txt = pg.inner_text('#grad-path-summary')
    ok('home shows 0 of 65', '0 of 65 complete' in txt, txt.replace('\n', ' | ')[:120])
    ok('and starts them at item 1, on the foundation skill it needs',
       'Next up: 1. Whole-Number Operations' in txt and 'start with' in txt,
       [l for l in txt.split('\n') if 'Next' in l])

    print('\n== a student through tier 3 ==')
    # Invented progress: every skill at tier 3 or below mastered.
    expected = pg.evaluate("""() => {
      for (const n of Object.values(MATH_GRAPH_V2.nodes)) if (n.dt <= 3) skillTreeData.skills[n.t] = { state: 'mastered', mastery_score: 100 };
      // What the plan says: items whose skills are all tier <= 3.
      return MATH_PLAN.core.domains.flatMap(d => d.items)
        .filter(it => it.skills.every(id => MATH_GRAPH_V2.nodes[id].dt <= 3)).length;
    }""")
    pg.evaluate("renderGradPathSummary()")
    txt = pg.inner_text('#grad-path-summary')
    ok(f'home count matches the plan ({expected} of 65)', f'{expected} of 65 complete' in txt, txt.split('\n')[1] if '\n' in txt else txt)

    pg.evaluate("showGradPath()"); pg.wait_for_timeout(300)
    r = pg.evaluate("""() => ({
      coreItems: document.querySelectorAll('.plan-core .plan-item').length,
      doneItems: document.querySelectorAll('.plan-core .plan-item.done').length,
      branches: [...document.querySelectorAll('.plan-branch')].map(s => ({ style: getComputedStyle(s).borderTopStyle, kicker: s.querySelector('.plan-kicker').textContent })),
      coreKicker: document.querySelector('.plan-core .plan-kicker').textContent,
      coreBorder: getComputedStyle(document.querySelector('.plan-core')).borderTopStyle,
    })""")
    ok('path lists all 65 core items', r['coreItems'] == 65, r['coreItems'])
    ok('path marks the same items complete', r['doneItems'] == expected, f"{r['doneItems']} vs {expected}")
    ok('core is marked Required, solid edge', r['coreKicker'].startswith('Required') and r['coreBorder'] == 'solid', f"{r['coreKicker']} / {r['coreBorder']}")
    ok('four branch sections, each dashed and marked Branch',
       len(r['branches']) == 4 and all(x['style'] == 'dashed' and x['kicker'].startswith('Branch') for x in r['branches']), r['branches'])

    print('\n== opening skills from the path ==')
    r = pg.evaluate("""() => {
      // A ready core skill: unlocked, playable, not done.
      const ready = [...document.querySelectorAll('.plan-core .plan-chip:not(.done):not(.locked):not(.soon)')][0];
      const locked = [...document.querySelectorAll('.plan-core .plan-chip.locked')][0];
      return { ready: ready && ready.dataset.skillId, locked: locked && locked.dataset.skillId };
    }""")
    ok('there is a ready core skill to open', bool(r['ready']))
    ok('and a locked one', bool(r['locked']))
    if r['locked']:
        # showLockedSkillInfo uses alert(); accept it and confirm nothing opened.
        pg.once('dialog', lambda d: d.accept())
        pg.evaluate(f"openPlanSkill('{r['locked']}')"); pg.wait_for_timeout(200)
        ok('a locked skill does not open a lesson', pg.evaluate("document.querySelector('.screen.active').id") == 'path-screen')
    if r['ready']:
        pg.evaluate(f"openPlanSkill('{r['ready']}')"); pg.wait_for_timeout(400)
        got = pg.evaluate("({ screens: [...document.querySelectorAll('.screen.active')].map(s => s.id), skill: document.getElementById('learning-skill-name').textContent })")
        want = pg.evaluate(f"MATH_GRAPH_V2.nodes['{r['ready']}'].ds")
        ok('a ready skill opens its lesson, and only that screen', got['screens'] == ['learning-screen'] and got['skill'] == want, got)

    print('\n== a branch opens on its own prerequisites ==')
    pg.close(); pg, errs2 = fresh(b); errs += errs2
    r = pg.evaluate("""() => {
      const id = MATH_GRAPH_V2.titleToId['Binary Numbers'];
      const before = planSkill(id).unlocked;
      // Master exactly its prerequisites, transitively, and nothing else.
      const stack = [...MATH_GRAPH_V2.nodes[id].hp];
      while (stack.length) { const x = stack.pop(); const n = MATH_GRAPH_V2.nodes[x];
        skillTreeData.skills[n.t] = { state: 'mastered', mastery_score: 100 }; stack.push(...n.hp); }
      const after = planSkill(id);
      const coreDone = MATH_PLAN.core.domains.flatMap(d => d.items).map(planItem).filter(i => i.done).length;
      return { before, after: after.unlocked, playable: after.playable, coreDone };
    }""")
    ok('Binary Numbers starts locked', r['before'] is False)
    ok('mastering only its prerequisites opens it', r['after'] is True, r)
    ok('while most of the core is still unfinished', r['coreDone'] < 65, r['coreDone'])
    pg.evaluate("renderGradPathSummary()")
    ok('home counts CS & Games skills as ready', '· ' in pg.inner_text('#grad-path-summary').split('CS & Games')[-1],
       pg.inner_text('#grad-path-summary').split('\n')[-1])
    pg.evaluate("showGradPath()"); pg.wait_for_timeout(200)
    chip = pg.evaluate("""() => { const c = document.querySelector(`.plan-chip[data-skill-id="${MATH_GRAPH_V2.titleToId['Binary Numbers']}"]`);
      return c && c.className; }""")
    ok('and its chip on the path is open, not locked', chip is not None and 'locked' not in chip and 'soon' not in chip, chip)

    print('\n== badges in Training Grounds ==')
    pg.evaluate("goToModeSelect(); selectMode('learning'); selectLearningTier(6)"); pg.wait_for_timeout(300)
    r = pg.evaluate("""() => { const cards = [...document.querySelectorAll('#skill-grid .skill-card')];
      return { cards: cards.length,
               core: cards.filter(c => c.querySelector('.plan-tag.core')).length,
               branch: cards.filter(c => c.classList.contains('branch-skill') && getComputedStyle(c).borderTopStyle === 'dashed').length }; }""")
    ok('tier 6 cards carry core badges', r['core'] > 0, r)
    ok('and branch cards are dashed', r['branch'] > 0, r)

    print('\n== phone ==')
    pg.close(); pg, errs3 = fresh(b, 390, 844); errs += errs3
    pg.evaluate("showGradPath()"); pg.wait_for_timeout(300)
    sw = pg.evaluate("document.documentElement.scrollWidth")
    ok('no sideways scroll at 390px', sw <= 390, sw)

    ok('no page errors', not errs, errs[:3])
    b.close()
print('FAILS:', fails); sys.exit(1 if fails else 0)
