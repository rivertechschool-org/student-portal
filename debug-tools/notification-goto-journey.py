#!/usr/bin/env python3
# A notification's "Go to" button, clicked as an admin.
#
# Reported 2026-10-21: a bug report in the admin notifications, "Go to it",
# ends in a blank screen. The staff-queue alerts the database writes (bug
# reports, materials, parent links, applications, bookings, system health)
# all link to '#admin', which is not a page; showSection hid every section
# and showed none. Each type now goes to the page that handles it, and
# showSection falls back to a real page for any name that is not one.
#
# Invented rows only; nothing touches a server.
#
# Run:  python -m http.server 8784 &   (repo root)
#       python debug-tools/notification-goto-journey.py
import os, sys
from playwright.sync_api import sync_playwright

URL = os.environ.get('PORTAL_URL', 'http://localhost:8784/portal/index.html')
CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fails = 0
def ok(label, cond, extra=''):
    global fails
    print(('  ok   ' if cond else '  FAIL ') + label + (f'  [{extra}]' if extra else ''))
    fails += (0 if cond else 1)

VISIBLE = "() => [...document.querySelectorAll('section[id$=\"-section\"]')].filter(s => !s.classList.contains('hidden')).map(s => s.id)"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None)
    pg = b.new_page(viewport={'width': 1300, 'height': 900})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.dismiss())
    pg.goto(URL)
    pg.wait_for_function("window.app && typeof window.app.showNotificationDetail === 'function'", timeout=30000)
    pg.wait_for_timeout(800)
    pg.evaluate("""() => {
      const app = window.app;
      app.userInfo = { user: { id: 'u-admin', email: 'admin@x.test' },
                       profile: { id: 'p-admin', user_type: 'admin', first_name: 'Ada', last_name: 'Admin' } };
      // Every table answers with no rows; the bug-report list just says so.
      const q = () => { const a = { select() { return a; }, eq() { return a; }, neq() { return a; }, order() { return a; },
        in() { return a; }, limit() { return a; }, gte() { return a; }, lte() { return a; }, is() { return a; },
        single() { return Promise.resolve({ data: null, error: null }); },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then(r, j) { return Promise.resolve({ data: [], error: null }).then(r, j); } }; return a; };
      app.auth = app.auth || {};
      app.auth.supabase = { from: q, rpc: () => q(), functions: { invoke: () => Promise.resolve({}) } };
      app.supabaseQuery = (fn) => fn();
      app.notifications = [
        { id: 'n-bug', type: 'bug_report', title: 'New bug report', message: 'someone@x.test reported: the page goes blank',
          link: '#admin', is_read: false, created_at: new Date().toISOString(), metadata: {} },
        { id: 'n-sys', type: 'system', title: 'New Bug Report Submitted', message: 'A student reported a bug',
          link: null, is_read: false, created_at: new Date().toISOString(), metadata: { alertType: 'bug_report' } },
        { id: 'n-mat', type: 'material_request', title: 'New materials request', message: 'Someone requested: pencils',
          link: '#admin', is_read: false, created_at: new Date().toISOString(), metadata: {} },
        { id: 'n-app', type: 'enrollment_application', title: 'New application', message: 'An application',
          link: '#admin', is_read: false, created_at: new Date().toISOString(), metadata: {} },
      ];
    }""")

    def go(nid):
        pg.evaluate(f"window.app.showNotificationDetail(window.app.notifications.find(n => n.id === '{nid}'))")
        btn = pg.locator('#notification-detail-modal button', has_text='Go to')
        label = btn.inner_text() if btn.count() else ''
        if btn.count(): btn.click()
        pg.wait_for_timeout(1200)
        return label, pg.evaluate(VISIBLE)

    print('\n== a bug report notification ==')
    label, vis = go('n-bug')
    ok('the button names the place', 'Bug Reports' in label, label)
    ok('Go to opens Admin Settings, not a blank screen', vis == ['admin-settings-section'], str(vis))
    box = pg.locator('#bug-reports-container')
    ok('  with the bug report list loaded', box.count() == 1 and 'Load Bug Reports' not in box.inner_text(), box.inner_text()[:80] if box.count() else 'missing')

    print('\n== the alert the page itself sends (no link) ==')
    pg.evaluate("window.app.showSection('home')")
    label, vis = go('n-sys')
    ok('it also gets a Go to Bug Reports button', 'Bug Reports' in label, label)
    ok('  and lands on Admin Settings', vis == ['admin-settings-section'], str(vis))

    print('\n== other staff queues that link to #admin ==')
    label, vis = go('n-mat')
    ok('materials request opens Materials Requests', vis == ['materials-requests-section'], f'{label} {vis}')
    label, vis = go('n-app')
    ok('an application opens Enrollment', vis == ['admin-enrollment-section'], f'{label} {vis}')

    print('\n== any page name that does not exist ==')
    pg.evaluate("window.app.showSection('admin')")
    ok("showSection('admin') shows the admin dashboard", pg.evaluate(VISIBLE) == ['admin-dashboard-section'], str(pg.evaluate(VISIBLE)))
    pg.evaluate("window.app.navigateToLink('#no-such-page')")
    ok('an unknown #page shows home, not nothing', pg.evaluate(VISIBLE) == ['home-section'], str(pg.evaluate(VISIBLE)))

    ok('no page errors', not errs, '; '.join(errs[:3]))
    b.close()

print(f"\n{'ALL OK' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
