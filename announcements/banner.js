// Announcement banners at the top of the sign-in page (/) and the portal
// (/portal/). Pages here share no code, so this is one small file both include.
//
// What shows comes from one public call, rt_announcements_live, which answers
// for whoever is asking: signed out, a parent, a student or staff. It returns
//   - the banners an admin wrote (📣 Announcements) that are live right now
//     for that audience: they appear at their start time and go at their end
//     time on their own, so nobody has to remember to take one down;
//   - conference days live on the public sign-up form within the next week
//     (not to students), shown as "Parent-teacher conferences are this week".
//
// Each banner has a close button. Closing is remembered in this browser only
// (localStorage), keyed by the banner AND when it was last edited, so an
// edited banner shows again. Nothing about who closed what leaves the browser.
//
// Placement: the first element with data-announcements, else the top of
// <body>. In the portal (data-announcements="portal"), a parent who can book
// conferences inside the portal is taken there from the conference banner.
//
// Before the database side exists the call 404s; the conference banner then
// falls back to the public conference-days call, and nothing else shows.
(function () {
  const URL_ = 'https://joxvhzxkrcigknsdrusr.supabase.co';
  const KEY = 'sb_publishable_xgvdFBaHCJKl9p-Lu61aZw_3oLkeTtc';
  const SESSION_KEY = 'sb-joxvhzxkrcigknsdrusr-auth-token';
  const CLOSED_KEY = 'rt-announcements-closed';
  const SIGNUP = '/conferences/';
  const WHO = 'For full-time junior high and high school families.';

  // ---- dates -----------------------------------------------------------
  function isoToday(now) {
    const d = now || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function daysBetween(fromIso, toIso) {
    const p = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    return Math.round((p(toIso) - p(fromIso)) / 86400000);
  }
  function dayName(iso) {
    const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // Conference days within a week (today included), soonest first.
  function upcoming(days, todayIso) {
    return (Array.isArray(days) ? days : [])
      .filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(String(d.day || '')))
      .map(d => ({ id: d.id, day: d.day, inDays: daysBetween(todayIso, d.day) }))
      .filter(d => d.inDays >= 0 && d.inDays <= 7)
      .sort((x, y) => x.inDays - y.inDays);
  }

  // "today", "tomorrow", or "this week: Wednesday, November 18" (and any second day).
  function headline(list) {
    if (!list.length) return '';
    const first = list[0];
    const when = first.inDays === 0 ? `today, ${dayName(first.day)}`
      : first.inDays === 1 ? `tomorrow, ${dayName(first.day)}`
      : `this week: ${dayName(first.day)}`;
    const more = list.slice(1).map(d => dayName(d.day));
    return `Parent-teacher conferences are ${when}${more.length ? ` and ${more.join(' and ')}` : ''}.`;
  }

  // ---- what to show ----------------------------------------------------
  // One list of banners, each { key, tone, text, sub, url, label, kind }.
  function bannersFrom(live, todayIso) {
    const out = [];
    const conf = upcoming(live && live.conferences, todayIso);
    if (conf.length) {
      out.push({ key: 'conf:' + conf.map(d => d.id + '@' + d.day).join(','), kind: 'conference', tone: 'info',
        text: headline(conf), sub: WHO, url: SIGNUP, label: 'Sign up for a time' });
    }
    for (const a of (live && live.announcements) || []) {
      if (!a || !a.id || !a.message) continue;
      out.push({ key: 'a:' + a.id + '@' + (a.updated_at || ''), kind: 'announcement',
        tone: a.tone === 'important' ? 'important' : 'info', text: String(a.message), sub: '',
        url: safeUrl(a.link_url), label: a.link_label || 'Open' });
    }
    // Important ones first; the order within each kind is the server's.
    return out.sort((x, y) => (y.tone === 'important') - (x.tone === 'important'));
  }

  // Only links to this site or https elsewhere; anything else is dropped.
  function safeUrl(u) {
    const s = String(u || '');
    return /^(https:\/\/|\/)[^\s<>"]*$/.test(s) ? s : '';
  }

  // ---- closing, remembered in this browser -----------------------------
  function closedKeys(store) {
    try { const v = JSON.parse((store || localStorage).getItem(CLOSED_KEY) || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function rememberClosed(key, store) {
    try {
      const keys = closedKeys(store).filter(k => k !== key);
      keys.push(key);
      (store || localStorage).setItem(CLOSED_KEY, JSON.stringify(keys.slice(-60)));
    } catch (e) { /* private window: it just shows again next time */ }
  }
  function visible(list, store) {
    const closed = new Set(closedKeys(store));
    return list.filter(b => !closed.has(b.key));
  }

  // ---- drawing ---------------------------------------------------------
  function esc(t) {
    return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render(list, doc, store) {
    doc = doc || document;
    const old = doc.getElementById('announcement-banners');
    if (old) old.remove();
    const show = visible(list, store);
    if (!show.length) return null;
    const mount = doc.querySelector('[data-announcements]');
    const portal = mount && mount.getAttribute('data-announcements') === 'portal';
    const wrap = doc.createElement('div');
    wrap.id = 'announcement-banners';
    show.forEach(b => {
      const box = doc.createElement('div');
      box.className = 'announcement-banner';
      box.setAttribute('role', b.tone === 'important' ? 'alert' : 'status');
      box.dataset.key = b.key;
      const accent = b.tone === 'important' ? '245,87,108' : '106,169,255';
      box.style.cssText = 'display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;margin:0 0 12px;padding:12px 14px;'
        + `border-radius:10px;border:1px solid rgba(${accent},0.6);background:rgba(${accent},0.13);`
        + 'color:inherit;font-size:15px;line-height:1.4;position:relative;padding-right:44px;';
      const icon = b.kind === 'conference' ? '🤝' : b.tone === 'important' ? '⚠️' : '📣';
      box.innerHTML = `<span style="font-size:20px;" aria-hidden="true">${icon}</span>
        <span style="flex:1 1 220px;white-space:pre-line;"><b>${esc(b.text)}</b>${b.sub ? `<br><span style="opacity:0.85;">${esc(b.sub)}</span>` : ''}</span>
        ${b.url ? `<a href="${esc(b.url)}" class="announcement-link" style="display:inline-block;padding:8px 14px;border-radius:8px;background:rgb(${accent});color:#0b1020;font-weight:700;text-decoration:none;white-space:nowrap;"${/^https:/.test(b.url) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(b.label)}</a>` : ''}
        <button type="button" class="announcement-close" aria-label="Close this announcement" title="Close"
          style="position:absolute;top:8px;right:8px;width:30px;height:30px;border:none;border-radius:6px;background:transparent;color:inherit;font-size:20px;line-height:1;cursor:pointer;opacity:0.75;">×</button>`;
      box.querySelector('.announcement-close').addEventListener('click', () => {
        rememberClosed(b.key, store);
        box.remove();
        if (!wrap.children.length) wrap.remove();
      });
      if (portal && b.kind === 'conference') {
        // A parent with a day to book in the portal books there: their
        // children are already known, so there is nothing to type.
        box.querySelector('.announcement-link').addEventListener('click', (e) => {
          const app = (doc.defaultView || window).app;
          if (app && app.userInfo?.profile?.user_type === 'parent' && (app.parentConferences || []).length
              && typeof app.showParentConferences === 'function') {
            e.preventDefault();
            app.showParentConferences();
          }
        });
      }
      wrap.appendChild(box);
    });
    if (mount) mount.appendChild(wrap);
    else doc.body.insertBefore(wrap, doc.body.firstChild);
    return wrap;
  }

  // ---- loading ---------------------------------------------------------
  // The signed-in session, if this browser has a current one, so the answer
  // is for this person; otherwise ask as a visitor.
  function sessionToken() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      const t = s && (s.access_token || (s.currentSession && s.currentSession.access_token));
      const exp = s && (s.expires_at || (s.currentSession && s.currentSession.expires_at));
      return t && (!exp || exp * 1000 > Date.now() + 30000) ? t : null;
    } catch (e) { return null; }
  }

  async function call(name, token) {
    const headers = { apikey: KEY, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${URL_}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: '{}' });
  }

  async function fetchLive() {
    const token = sessionToken();
    let r = await call('rt_announcements_live', token);
    if (r.status === 401 && token) r = await call('rt_announcements_live', null);
    if (r.ok) return r.json();
    if (r.status === 404) {
      // Database side not there yet: conferences still come through.
      const c = await call('rt_conference_public_days', null);
      return c.ok ? { viewer: 'visitors', announcements: [], conferences: await c.json() } : null;
    }
    return null;
  }

  let loading = null;
  function load() {
    loading = (async () => {
      try {
        const live = await fetchLive();
        return live ? render(bannersFrom(live, isoToday())) : null;
      } catch (e) {
        return null;   // no banner is the right failure: the page works without it
      }
    })();
    return loading;
  }

  const api = { upcoming, headline, bannersFrom, visible, render, load, rememberClosed, closedKeys, safeUrl, isoToday, WHO, SIGNUP, CLOSED_KEY };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  window.RTAnnouncements = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
