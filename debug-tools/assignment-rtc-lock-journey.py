#!/usr/bin/env python3
# Edit Assignment's RTC reward: open until the first grade, locked after.
# (Jordan, 2026-10-22.) Three journeys against a stub database:
#   nobody graded   -> the field is editable and the new amount is saved
#   2 graded        -> the field is locked with the reason, and not sent
#   graded mid-edit -> the database refuses (rtc_reward_locked); the window
#                      says why, locks the field at the old amount, and a
#                      second Save goes through without it
# The database guard itself is tested in the backend repo
# (supabase/tests/rtc_reward_locks_after_first_grade.sql).
#
# Run:  python -m http.server 8791 &   (repo root)
#       python debug-tools/assignment-rtc-lock-journey.py
import os, sys
from playwright.sync_api import sync_playwright
JS = """async (graded) => {
  const A = { id:'a1', class_id:'c1', title:'Essay', due_date:new Date().toISOString(), max_points:10, rtc_reward:30,
              assignment_type:'regular', grading_type:'points', is_published:true, assigned_to_all:true, description:'' };
  const sent = [];
  const q = (table) => {
    const st = { table, op:'select', vals:null, opts:null };
    const api = {
      select(c, o){ st.opts=o; return api; }, eq(){ return api; }, in(){ return api; }, order(){ return api; },
      update(v){ st.op='update'; st.vals=v; sent.push({table, v}); return api; },
      delete(){ st.op='delete'; return api; }, insert(v){ st.op='insert'; return api; },
      single(){ return Promise.resolve({ data: A, error:null }); },
      then(res){ let r;
        if (table==='assignment_submissions' && st.opts && st.opts.head) r = { count: graded, error:null };
        else if (table==='assignments' && st.op==='update' && window.__lockDb && 'rtc_reward' in st.vals && st.vals.rtc_reward!==30)
          r = { error: { message: 'rtc_reward_locked: 1 student(s) already graded' } };
        else r = { data: [], error:null };
        return Promise.resolve(r).then(res); }
    };
    return api;
  };
  app.auth = app.auth || {}; app.auth.supabase = { from: q };
  window.app.auth = app.auth;
  app.supabaseQuery = (fn) => fn();
  app.assignmentQuarters = [];
  app.loadClassAssignments = async () => {}; app.refreshCurrentView = async () => {};
  const notes = []; app.showNotification = (m,t) => notes.push(t+': '+m);
  await app.editAssignment('a1');
  await new Promise(r => setTimeout(r, 300));
  const box = document.getElementById('edit-assignment-rtc-reward');
  const info = { present: !!box, disabled: box && box.disabled, label: box && box.closest('.form-group').innerText.replace(/\s+/g,' ').slice(0,220) };
  if (box && !box.disabled) { box.value = '50'; box.dispatchEvent(new Event('input')); info.preview = document.getElementById('edit-assignment-rtc-tier-preview').textContent; }
  await app.submitEditAssignment('a1','c1');
  info.sentRtc = sent.filter(s=>s.table==='assignments').map(s=>s.v.rtc_reward);
  info.notes = notes.map(n=>n.slice(0,140));
  if (window.__lockDb) { info.afterRace = { disabled: box.disabled, value: box.value };
    sent.length = 0; await app.submitEditAssignment('a1','c1'); info.secondSave = sent.filter(s=>s.table==='assignments').map(s=>s.v.rtc_reward); }
  app.closeModal && app.closeModal('edit-assignment');
  return info;
}"""
BASE = os.environ.get('SITE_URL', 'http://localhost:8791')
CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fails = 0
def ok(label, cond, extra=''):
    global fails
    print(('  ok   ' if cond else '  FAIL ') + label + (f'  [{extra}]' if extra else ''))
    fails += (0 if cond else 1)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)
    for label, graded, race in [('nobody graded', 0, False), ('2 graded', 2, False), ('graded mid-edit', 0, True)]:
        pg = b.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('dialog', lambda d: d.accept())
        pg.goto(BASE + '/portal/index.html'); pg.wait_for_timeout(2500)
        if race: pg.evaluate('window.__lockDb = true')
        r = pg.evaluate(JS, graded)
        print(f'\n== {label} ==')
        if label == 'nobody graded':
            ok('the RTC field is there and editable', r['present'] and not r['disabled'])
            ok('the tier preview follows the new amount', '50' in (r.get('preview') or ''), r.get('preview'))
            ok('the new amount is saved', r['sentRtc'] == [50], str(r['sentRtc']))
        elif label == '2 graded':
            ok('the RTC field is locked', r['present'] and r['disabled'])
            ok('  and says why', 'Locked: 2 students' in r['label'], r['label'])
            ok('the amount is not sent', r['sentRtc'] == [None], str(r['sentRtc']))
        else:
            ok('the refusal is explained', any('just locked' in n for n in r['notes']), '; '.join(r['notes']))
            ok('the field locks back at the old amount', r['afterRace'] == {'disabled': True, 'value': '30'}, str(r['afterRace']))
            ok('a second Save goes through without it', r['secondSave'] == [None], str(r['secondSave']))
        ok('no page errors', not errs, '; '.join(errs[:2]))
        pg.close()
    b.close()

print(f"\n{'ALL OK' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
