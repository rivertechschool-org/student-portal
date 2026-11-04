// Class Resources: a PDF on a phone opens in the phone's own viewer.
//
// 2026-11-04: the in-portal preview is an iframe, which Chrome on Android
// leaves blank and Safari on iPhone/iPad shows as one unscrollable page. This
// runs the real previewDriveFile, _mobilePdfMode and _previewKind with a
// stand-in for the browser and the file fetch.
//
// Run: node tests/resource-pdf-phones.test.js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'index.html'), 'utf8');

function method(name) {
  let start = html.indexOf(`\n      ${name}(`);
  if (start < 0) start = html.indexOf(`\n      async ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let i = html.indexOf('{', html.indexOf(')', start)), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start + 1, i + 1).trim();
}

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const proto = eval(`({ ${['previewDriveFile', '_mobilePdfMode', '_previewKind'].map(method).join(',\n')} })`);

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
};

async function run(device, { mime = 'application/pdf', name = 'Unit 3 notes.pdf', hint = 'application/pdf', blockTab = false, fetchFails = false } = {}) {
  const log = { opened: 0, tab: null, saved: null, modal: null, notes: [], openedBeforeFetch: null };
  let fetched = false;
  // Node has its own read-only navigator; replace it outright.
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: UA[device], maxTouchPoints: device === 'ipad' ? 5 : 0 }, configurable: true, writable: true });
  global.window = { open: () => { log.opened++; log.openedBeforeFetch = !fetched; if (blockTab) return null; log.tab = { closed: false, location: {}, close() { this.closed = true; } }; return log.tab; } };
  global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
  global.setTimeout = () => {};
  global.document = { getElementById: () => null };
  const a = Object.create(proto);
  a._fetchDriveBlob = async () => { fetched = true; if (fetchFails) throw new Error('gone'); return { type: mime, text: async () => '' }; };
  a._saveBlob = (blob, n) => { log.saved = n; };
  a.showModal = (id) => { log.modal = id; };
  a.showNotification = (m) => log.notes.push(m);
  a.escapeHtml = (x) => x;
  await a.previewDriveFile('f1', name, 'c1', hint);
  return log;
}

(async () => {
  let r = await run('windows');
  ok('a computer still previews a PDF in the portal', r.modal === 'resource-preview' && !r.opened && !r.saved);
  r = await run('mac');
  ok('  a Mac too (no touch screen)', r.modal === 'resource-preview' && !r.opened);

  r = await run('iphone');
  ok('an iPhone opens the PDF in a new tab', r.opened === 1 && r.tab.location.href === 'blob:x' && !r.tab.closed && !r.modal && !r.saved);
  ok('  the tab is opened during the tap, before the download', r.openedBeforeFetch === true);
  r = await run('ipad');
  ok('  an iPad, which calls itself a Mac, does too', r.opened === 1 && r.tab.location.href === 'blob:x' && !r.modal);
  r = await run('iphone', { hint: 'application/vnd.google-apps.document', name: 'Reading guide', mime: 'application/pdf' });
  ok('  so does a Google Doc, which arrives as a PDF', r.opened === 1 && r.tab.location.href === 'blob:x');
  r = await run('iphone', { blockTab: true });
  ok('  if the tab is blocked, the PDF is saved instead', r.saved === 'Unit 3 notes.pdf' && !r.modal);

  r = await run('android');
  ok('an Android phone saves the PDF to open in its viewer', r.saved === 'Unit 3 notes.pdf' && !r.opened && !r.modal && /Downloaded/.test(r.notes.join()));
  r = await run('android', { hint: 'application/vnd.google-apps.presentation', name: 'Cells slides', mime: 'application/pdf' });
  ok('  a Google Slides deck is saved with .pdf on the end', r.saved === 'Cells slides.pdf');

  r = await run('iphone', { mime: 'image/png', hint: 'image/png', name: 'diagram.png' });
  ok('a picture on a phone still previews in the portal', r.modal === 'resource-preview' && !r.opened);
  r = await run('iphone', { fetchFails: true });
  ok('a PDF that fails to arrive closes the tab it opened', r.opened === 1 && r.tab.closed && /gone/.test(r.notes.join()));
  r = await run('iphone', { hint: 'application/pdf', mime: 'image/jpeg', name: 'scan' });
  ok('  so does one that turns out not to be a PDF', r.tab.closed && r.modal === 'resource-preview');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
