// Notification behaviour. Extract PortalUI first:  node tests/extract-portalui.js
const els = [];
const mk = (tag) => ({
  tagName: tag, style: {}, children: [], id: '', className: '',
  textContent: '', innerHTML: '', offsetHeight: 50, parentNode: null, type: '',
  setAttribute(){}, addEventListener(){}, onclick: null,
  appendChild(c){ c.parentNode = this; this.children.push(c); return c; },
  remove(){ const i = els.indexOf(this); if (i>=0) els.splice(i,1); this.parentNode = null; },
  querySelector(){ return { onclick: null }; },
});
global.document = {
  createElement: mk,
  getElementById: (id) => els.find(e => e.id === id) || null,
  querySelectorAll: (sel) => sel === '.portal-notification'
    ? els.filter(e => String(e.className||'').includes('portal-notification')) : [],
  head: mk('head'),
  body: { appendChild(c){ els.push(c); c.parentNode = { }; return c; } },
};
const timers = [];
global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
const runTimers = () => { const t = timers.splice(0); t.forEach(x => x.fn()); };

const PortalUI = require('./portalui.js');
let fails = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok?'pass':'FAIL'}  ${label.padEnd(46)} got=${got} want=${want}`);
};

// 1. An error must not schedule its own removal.
PortalUI.showNotification('boom', 'error');
check('error is sticky (no dismiss timer)', timers.length, 0);
check('error rendered', els.filter(e=>String(e.className).includes('portal-notification')).length, 1);
const firstNote = els.find(e => String(e.className).includes('portal-notification'));
check('error has a close button', firstNote.children.length, 2);
check('close button is a button', firstNote.children[1].tagName, 'button');

// 2. Stacking: the second must not sit on top of the first.
PortalUI.showNotification('second', 'error');
const tops = els.filter(e=>String(e.className).includes('portal-notification')).map(e=>e.style.top);
check('two notifications get different tops', new Set(tops).size, 2);
check('first at 20px', tops[0], '20px');

// 3. Info still auto-dismisses.
timers.length = 0;
PortalUI.showNotification('hello', 'info');
check('info schedules a dismiss', timers.length, 1);
check('info duration is 3s', timers[0].ms, 3000);

// 4. Warning lingers but is not sticky.
timers.length = 0;
PortalUI.showNotification('careful', 'warning');
check('warning schedules a dismiss', timers.length, 1);
check('warning lingers 12s', timers[0].ms, 12000);

// 5. Everything is logged, newest first.
check('log holds all four', PortalUI._noteLog.length, 4);
check('newest first', PortalUI._noteLog[0].message, 'careful');

// 6. The badge counts only errors and warnings.
const badge = els.find(e => e.id === 'portal-issue-badge');
check('badge exists', !!badge, true);
check('badge counts 3 (2 errors + 1 warning)', badge.textContent, '3 messages');
check('badge is red when errors present', badge.style.background, '#f44336');

// 7. Explicit duration still wins.
timers.length = 0;
PortalUI.showNotification('custom', 'error', 5000);
check('explicit duration overrides sticky', timers[0].ms, 5000);

console.log(fails ? `\n${fails} FAILING` : '\nall pass');
