#!/usr/bin/env python3
# Math Dojo: the Belt Test opens everything beneath what a student showed, and
# the Progress Check measures without moving skills and remembers each result.
#
# 2026-10-10: the check covers all 65 core skills easiest first, two questions
# each, and stops at the student's edge (4 skills in a row never seen or both
# wrong); later skills are "not reached".
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

    print('\n== Progress Check: the 65 core skills, easiest first ==')
    pg, errs2 = fresh(b); errs += errs2
    pg.evaluate("""() => {
      skillTreeData.skills = {};
      for (const n of Object.values(MATH_GRAPH_V2.nodes)) if (n.dt <= 3) skillTreeData.skills[n.t] = { state: 'mastered', mastery_score: 100, p_mastered: 0.97 };
      saveSkillTreeData();
      try { localStorage.removeItem(dojoOwnedKey('math_progress_checks')); } catch (e) {}
    }""")
    pg.evaluate("selectMode('progress')"); pg.wait_for_timeout(300)
    plan = pg.evaluate("""() => { const x = buildProgressCheck(true).items, b = buildProgressCheck(false).items;
      return { disabled: document.getElementById('start-progress-btn').disabled,
        prepDisabled: document.getElementById('start-collegeprep-btn').disabled,
        n: x.length, sections: x.map(i => i.section), basic: b.length, basicSections: [...new Set(b.map(i => i.section))],
        core: x.filter(i => i.section === 'core').map(i => i.level),
        ready: x.filter(i => i.section === 'R').map(i => i.level),
        codes: new Set(x.map(i => i.code)).size }; }""")
    nR = len(plan['ready'])
    ok('the setup screen plans all 65 core skills', not plan['disabled'] and len(plan['core']) == 65 and plan['codes'] == plan['n'], plan['n'])
    ok('the Progress Check is the 65 core skills only', plan['basic'] == 65 and plan['basicSections'] == ['core'], plan['basic'])
    ok('the College Prep Check adds Stage 7 (66-73) after every core skill', nR == 8 and plan['sections'] == ['core'] * 65 + ['R'] * nR, nR)
    ok('both can be started', not plan['disabled'] and not plan['prepDisabled'])
    ok('easiest first within each', all(l[i] <= l[i + 1] for l in (plan['core'], plan['ready']) for i in range(len(l) - 1)))
    ok('no history yet', 'No checks yet' in pg.inner_text('#progress-history'))

    STATES = "JSON.stringify(Object.fromEntries(Object.entries(skillTreeData.skills).map(([k, v]) => [k, [v.state, v.p_mastered]])))"

    def run_check(policy, limit=400, extended=False):
        """Answer until the check ends. policy(item_position, question_no) -> 'right' | 'wrong' | 'never'."""
        pg.evaluate(f"startProgressCheck({'true' if extended else 'false'})")
        asked, seen_pairs = 0, []
        while asked < limit and pg.evaluate("document.querySelector('.screen.active').id") == 'test-screen':
            e = pg.evaluate("progressState.entry && { i: progressState.entry.i, k: progressState.entry.k }")
            if not e: break
            seen_pairs.append((e['i'], e['k']))
            act = policy(e['i'], e['k'])
            if act == 'never':
                pg.evaluate("submitNeverSeen()")
            else:
                pg.evaluate(ANSWER, act == 'right')
                pg.evaluate("nextQuestion()")
            asked += 1
        pg.wait_for_timeout(200)
        return asked, seen_pairs, pg.evaluate("progressHistoryLocal().slice(-1)[0]")

    print('\n== a student who knows it all goes through every skill ==')
    before = pg.evaluate(STATES)
    asked, pairs, rec = run_check(lambda i, k: 'right')
    ok('130 questions: two on each of the 65', asked == 130, asked)
    ok('the two questions on one skill are never back to back',
       all(pairs[j][0] != pairs[j + 1][0] for j in range(len(pairs) - 1)))
    ok('it ends as complete, all 65 secure', rec['reason'] == 'complete' and rec['summary']['secure'] == 65, rec['summary'])
    ok('a Progress Check has no Stage 7 in it', rec['kind'] == 'progress' and rec['summary']['readiness']['total'] == 0, rec['summary']['readiness'])

    print('\n== the extended College Prep Check ==')
    pg.evaluate("goToModeSelect(); selectMode('progress')"); pg.wait_for_timeout(200)
    asked, pairs, rec = run_check(lambda i, k: 'right', extended=True)
    ok('two questions on every skill: the 65, then Stage 7', asked == 2 * plan['n'], (asked, plan['n']))
    ok('saved as a College Prep Check', rec['kind'] == 'college_prep' and 'College Prep' in pg.inner_text('#progress-result-title'))
    ok('Stage 7 is counted on its own, not in the 65', rec['summary']['secure'] == 65 and rec['summary']['readiness']['total'] == nR and rec['summary']['readiness']['secure'] == nR, rec['summary']['readiness'])
    ok('the results report Stage 7', 'Stage 7 College & Assessment Readiness: 8 secure' in pg.inner_text('#progress-result-summary'))
    ok('no edge when everything was reached', rec['summary']['edge'] is None)
    ok('no skill state or mastery estimate changed', pg.evaluate(STATES) == before)

    print('\n== a student who reaches topics they have never seen ==')
    pg.evaluate("goToModeSelect(); selectMode('progress')"); pg.wait_for_timeout(200)
    # Right on the first 20 skills (in difficulty order), then "never seen".
    asked, pairs, rec = run_check(lambda i, k: 'right' if i < 20 else 'never', extended=True)
    k = rec['summary']
    ok('it stops at the edge', rec['reason'] == 'edge', rec['reason'])
    ok('the edge is the first never-seen skill',
       k['edge'] and k['edge']['code'] == rec['items'][20]['code'], (k['edge'], rec['items'][20]['code']))
    beyond = [it for it in rec['items'][20:] if it['status'] == 'notseen']
    ok('it stops right after the 4th never-seen skill', len(beyond) == 4, len(beyond))
    ok('"never seen" skips that skill\'s second question',
       not any(i >= 20 and kk == 1 for i, kk in pairs), [p for p in pairs if p[0] >= 20][:6])
    ok('Stage 7 is not reached when the core edge stops the check', rec['summary']['readiness']['notreached'] == nR, rec['summary']['readiness'])
    ok('everything after is "not reached", not wrong',
       all(it['status'] == 'notreached' for it in rec['items'][20 + len(beyond):]) and k['notreached'] == 65 - 20 - len(beyond), k)
    ok('the first 20 are secure', k['secure'] == 20, k['secure'])
    s = pg.inner_text('#progress-result-summary')
    ok('the results name the edge', 'Your edge right now' in s and k['edge']['title'] in s, s.replace('\n', ' ')[:160])

    print('\n== wrong answers find the edge too ==')
    pg.evaluate("goToModeSelect(); selectMode('progress')"); pg.wait_for_timeout(200)
    asked, pairs, rec = run_check(lambda i, k: 'right' if i < 30 else 'wrong')
    ok('both wrong four times in a row also stops', rec['reason'] == 'edge' and rec['summary']['edge']['code'] == rec['items'][30]['code'], rec['summary'].get('edge'))
    ok('those count as not yet, not not-seen', rec['summary']['notseen'] == 0 and rec['summary']['notyet'] >= 4, rec['summary'])

    print('\n== one wrong answer is not the edge ==')
    pg.evaluate("goToModeSelect(); selectMode('progress')"); pg.wait_for_timeout(200)
    # Second question of every skill wrong: every skill shaky, none "beyond".
    asked, pairs, rec = run_check(lambda i, k: 'right' if k == 0 else 'wrong')
    ok('shaky everywhere, so it goes all the way through', rec['reason'] == 'complete' and rec['summary']['shaky'] == 65, rec['summary'])

    print('\n== the next check shows what moved ==')
    pg.evaluate("goToModeSelect(); selectMode('progress')"); pg.wait_for_timeout(200)
    ok('past checks are listed', 'secure' in pg.inner_text('#progress-history'))
    asked, pairs, rec = run_check(lambda i, k: 'right')
    s2 = pg.inner_text('#progress-result-summary')
    import re as _re
    mv = _re.search(r'(\d+) moved up', s2)
    ok('all right after an all-shaky check: every skill moved up', 'Since your last check' in s2 and mv and int(mv.group(1)) == 65, s2.replace('\n', ' ')[:200])

    print('\n== ending early ==')
    pg.evaluate("goToModeSelect(); selectMode('progress'); startProgressCheck(false)")
    for _ in range(4):
        pg.evaluate(ANSWER, True); pg.evaluate("nextQuestion()")
    pg.evaluate("endTest()"); pg.wait_for_timeout(300)
    rec = pg.evaluate("progressHistoryLocal().slice(-1)[0]")
    ok('ending early still saves what was answered', 'Ended early' in pg.inner_text('#progress-result-sub') and rec['reason'] == 'stopped')
    ok('a skill with only one answer is never called secure',
       all(i['status'] != 'secure' or i['total'] == 2 for i in rec['items']))
    ok('the rest are not reached', rec['summary']['notreached'] >= 60, rec['summary'])

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
    # The check now finds its own edge, so a student with no history can take it.
    pg.evaluate("skillTreeData.skills = {}; saveSkillTreeData(); goToModeSelect(); selectMode('progress')"); pg.wait_for_timeout(200)
    ok('can take it: the check finds where they are', not pg.evaluate("document.getElementById('start-progress-btn').disabled") and pg.evaluate("buildProgressCheck(false).items.length") == 65)

    ok('no page errors', not errs, errs[:3])
    b.close()
print('FAILS:', fails); sys.exit(1 if fails else 0)
