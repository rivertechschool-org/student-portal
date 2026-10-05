#!/usr/bin/env python3
# Math Dojo: the Belt Test opens everything beneath what a student showed, and
# the Progress Check measures without moving skills and remembers each result.
#
# Reported 2026-10-05:
#   * "a student can get most of their skills around T3 and T1 is still
#     locked" - the Belt Test only opened tiers strictly below a placement
#     tier computed from tier accuracy, and only 1-hop prerequisites
#   * the Belt Test was being used as a progress test, which it cannot be
#     (seeds from prior beliefs, only raises skills, different every time,
#     nothing comparable saved). The Progress Check is the replacement.
#
# Progress is invented in the page; nothing touches a server. Answers are
# given by reading the question's own answer, so "right" and "wrong" runs are
# exact.
#
# Run:  python -m http.server 8793 &   (repo root)
#       python debug-tools/progress-check-journey.py
import os, sys, json
from playwright.sync_api import sync_playwright

BASE = os.environ.get('SITE_URL', 'http://localhost:8793')
CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fails = 0
def ok(label, cond, extra=''):
    global fails
    print(('  ok   ' if cond else '  FAIL ') + label + (f'  [{extra}]' if extra else ''))
    fails += (0 if cond else 1)

ANSWER = """(right) => {
  const q = state.currentQuestion;
  if (q.visual && q.visual.mode === 'interactive') {
    // Plot-the-point and similar: the answer is a position, not a choice.
    const t = q.visual.data.target !== undefined ? q.visual.data.target : q.visual.data.targetPoint;
    state.visualAnswer = right ? t : (typeof t === 'object' && t !== null
      ? Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === 'number' ? v + 7 : v])) : t);
  } else if (state.isTypedAnswer) {
    const input = document.getElementById('typed-answer-input');
    input.value = right ? String(q.answer) : 'zzz-wrong';
  } else {
    state.selectedAnswer = right ? q.answerIndex : (q.answerIndex + 1) % q.options.length;
  }
  submitAnswer();
}"""

def fresh(b):
    pg = b.new_page(viewport={'width': 1280, 'height': 900})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'{BASE}/games/math-dojo.html')
    pg.wait_for_function("typeof MATH_PLAN !== 'undefined' && typeof buildProgressCheck === 'function'", timeout=30000)
    pg.wait_for_timeout(800)
    # This device has no host, so the owned-blob key needs an owner.
    pg.evaluate("window.dojoUserId = 'u-test-student'")
    return pg, errs

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)

    print('\n== Belt Test: tier 3 mastered opens everything beneath ==')
    pg, errs = fresh(b)
    r = pg.evaluate("""() => {
      skillTreeData.skills = {};
      initScores();
      // Results like the report: most tested tier-3 skills mastered, almost
      // nothing asked lower down, so the tier-accuracy placement stays low.
      const t3 = TIERS[3].domains.slice(0, 8);
      t3.forEach(d => { state.domainScores[3][d] = { correct: 2, total: 2 }; });
      state.tierScores[3] = { correct: 9, total: 20, times: [] };   // 45%: placement stays at 1
      state.diag = null;
      applyBeltTestToTree();
      const locked = [];
      for (const t of [1, 2]) for (const d of TIERS[t].domains) {
        const st = skillTreeData.skills[getTreeSkillName(d)]?.state;
        if (!st || st === 'locked') locked.push(`T${t} ${d}`);
      }
      // Every prerequisite at any depth of a mastered skill.
      const deep = [];
      for (const d of t3) {
        const stack = [...(MATH_GRAPH_V2.nodes[MATH_GRAPH_V2.titleToId[getTreeSkillName(d)]] || { hp: [] }).hp];
        const seen = new Set();
        while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id);
          const n = MATH_GRAPH_V2.nodes[id]; const st = skillTreeData.skills[n.t]?.state;
          if (!st || st === 'locked') deep.push(n.t); stack.push(...n.hp); }
      }
      const credited = [1, 2].flatMap(t => TIERS[t].domains).filter(d => skillTreeData.skills[getTreeSkillName(d)]?.state === 'mastered');
      return { locked, deep: [...new Set(deep)], credited };
    }""")
    ok('no tier 1 or 2 skill is left locked', not r['locked'], ', '.join(r['locked'][:8]))
    ok('every prerequisite of a mastered skill, any depth, is open', not r['deep'], ', '.join(r['deep'][:8]))
    ok('and opening is not crediting: none of tiers 1-2 became mastered', not r['credited'], r['credited'][:5])
    pg.close()

    print('\n== Progress Check ==')
    pg, errs2 = fresh(b); errs += errs2
    pg.evaluate("""() => {
      skillTreeData.skills = {};
      for (const n of Object.values(MATH_GRAPH_V2.nodes)) if (n.dt <= 3) skillTreeData.skills[n.t] = { state: 'mastered', mastery_score: 100, p_mastered: 0.97 };
      for (const t of ['Slope', 'Percent Change', 'Two-Step Equations']) skillTreeData.skills[t] = { state: 'in_progress', mastery_score: 40, p_mastered: 0.4 };
      saveSkillTreeData();
      try { localStorage.removeItem(dojoOwnedKey('math_progress_checks')); } catch (e) {}
    }""")
    pg.evaluate("selectMode('progress')"); pg.wait_for_timeout(300)
    plan = pg.evaluate("({ text: document.getElementById('progress-setup-plan').innerText, disabled: document.getElementById('start-progress-btn').disabled, n: progressState.items.length, q: progressState.queue.length, kinds: progressState.items.map(i => i.kind) })")
    ok('the setup screen plans a check', not plan['disabled'] and plan['n'] >= 3, plan['text'][:120])
    ok('two questions per skill', plan['q'] == 2 * plan['n'], f"{plan['q']} for {plan['n']}")
    ok('it includes skills being worked on AND re-checks', 'frontier' in plan['kinds'] and 'recheck' in plan['kinds'], plan['kinds'])
    ok('no history yet', 'No checks yet' in pg.inner_text('#progress-history'))

    before = pg.evaluate("JSON.stringify(Object.fromEntries(Object.entries(skillTreeData.skills).map(([k, v]) => [k, [v.state, v.p_mastered]])))")
    pg.evaluate("startProgressCheck()"); pg.wait_for_timeout(200)
    hdr = pg.inner_text('#current-tier-display')
    ok('the test screen says which skill is being checked', hdr.startswith('Progress Check'), hdr[:90])
    # First pass right, second pass wrong: every item ends 1/2 = shaky.
    total = plan['q']
    for k in range(total):
        pg.evaluate(ANSWER, k < total // 2)
        pg.evaluate("nextQuestion()")
    pg.wait_for_timeout(300)
    res = pg.evaluate("""() => ({ screen: document.querySelector('.screen.active').id,
        summary: document.getElementById('progress-result-summary').innerText,
        rows: document.querySelectorAll('#progress-result-items .pc-row').length,
        hist: progressHistoryLocal() })""")
    ok('it ends on the results screen', res['screen'] == 'progress-result-screen', res['screen'])
    ok('every skill is listed', res['rows'] == plan['n'], res['rows'])
    first = res['hist'][-1] if res['hist'] else {}
    ok('first pass right, second wrong: every skill shaky', first.get('summary', {}).get('shaky') == plan['n'], first.get('summary'))
    ok('the check is saved on this device', len(res['hist']) == 1)
    after = pg.evaluate("JSON.stringify(Object.fromEntries(Object.entries(skillTreeData.skills).map(([k, v]) => [k, [v.state, v.p_mastered]])))")
    b_, a_ = json.loads(before), json.loads(after)
    changed = [k for k in b_ if b_[k] != a_.get(k)]
    ok('no skill state or mastery estimate changed', not changed, changed[:5])

    print('\n== a second check shows what moved ==')
    pg.evaluate("goToModeSelect(); selectMode('progress')"); pg.wait_for_timeout(300)
    ok('the first check is in the history', 'shaky' in pg.inner_text('#progress-history'), pg.inner_text('#progress-history')[:100])
    pg.evaluate("startProgressCheck()")
    n2 = pg.evaluate("progressState.queue.length")
    for k in range(n2):
        pg.evaluate(ANSWER, True)
        pg.evaluate("nextQuestion()")
    pg.wait_for_timeout(300)
    s2 = pg.inner_text('#progress-result-summary')
    ok('all right this time: skills report moving up', 'moved up' in s2 and 'Since your last check' in s2, s2.replace('\n', ' ')[:160])
    ok('two checks saved', len(pg.evaluate("progressHistoryLocal()")) == 2)

    print('\n== ending early ==')
    pg.evaluate("goToModeSelect(); selectMode('progress'); startProgressCheck()")
    pg.evaluate(ANSWER, True); pg.evaluate("nextQuestion()")
    pg.evaluate("endTest()"); pg.wait_for_timeout(300)
    ok('ending early still saves what was answered', 'Ended early' in pg.inner_text('#progress-result-sub') and len(pg.evaluate("progressHistoryLocal()")) == 3)
    ok('a skill with only one answer is never called secure',
       all(i['status'] != 'secure' or i['total'] == 2 for i in pg.evaluate("progressHistoryLocal()")[-1]['items']))

    print('\n== plot the point (found while building this) ==')
    # The coordinate plane keeps its answer in targetPoint; Submit read only
    # target, so every plot question threw on Submit and was never marked.
    r = pg.evaluate("""() => {
      const out = [];
      for (const [label, place] of [['right', t => t], ['wrong', t => ({ x: t.x + 1, y: t.y })], ['nothing placed', () => null]]) {
        let q; for (let i = 0; i < 200; i++) { q = generateQuestion(3, 'Coordinate Plane'); if (q.subType === 'plot') break; }
        state.mode = 'testing'; state.currentQuestion = q; state.selectedAnswer = null; renderQuestion();
        state.visualAnswer = place(q.visual.data.targetPoint);
        let err = null; try { submitAnswer(); } catch (e) { err = e.message; }
        out.push({ label, err, fb: document.getElementById('feedback').textContent });
      }
      return out;
    }""")
    for x in r:
        want = x['label'] == 'right'
        ok(f"plotting: {x['label']} is marked {'right' if want else 'wrong'}, no crash",
           x['err'] is None and (x['fb'].startswith('✓') if want else x['fb'].startswith('✗')), x)

    print('\n== a new student ==')
    pg.evaluate("skillTreeData.skills = {}; saveSkillTreeData(); goToModeSelect(); selectMode('progress')"); pg.wait_for_timeout(200)
    ok('is sent to the Belt Test first', 'Belt Test' in pg.inner_text('#progress-setup-plan') and pg.evaluate("document.getElementById('start-progress-btn').disabled"))

    ok('no page errors', not errs, errs[:3])
    b.close()
print('FAILS:', fails); sys.exit(1 if fails else 0)
