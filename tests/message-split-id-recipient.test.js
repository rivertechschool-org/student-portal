// Messages go to the recipient's SIGN-IN id.
//
// Reported 2026-11-13: a teacher messaging a student got a raw database error.
// The portal sent the profile id, which for a student an admin activated is a
// different id from their sign-in (linked by auth_user_id). The conversation list
// also looked names up by profile id only, so those students showed as
// "Unknown User", and opening their chat from a profile missed the thread.
//
// The stub refuses a message whose recipient is not a sign-in id. Invented people only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync(require('node:path').join(__dirname, '../portal/index.html'), 'utf8');
function method(name) {
  const start = html.search(new RegExp('\\n      (async )?' + name + '\\('));
  assert(start >= 0, name);
  const end = html.indexOf('\n      }\n', start);
  return eval('(' + html.slice(start, end + 9).trim().replace(/^(async )?\w+\(/, (_, a) => (a || '') + 'function(') + ')');
}

const uuid = (n) => `${n}${n}${n}${n}${n}${n}${n}${n}-0000-4000-8000-000000000000`;
const ME = uuid('a');                                  // the teacher: same id both ways
const WREN_PROFILE = uuid('b'), WREN_SIGNIN = uuid('c');   // activated student: split ids
const OTTO = uuid('d');                                // student with no sign-in yet
const profiles = [
  { id: ME, auth_user_id: ME, first_name: 'Hazel', last_name: 'Marsh', user_type: 'teacher', account_status: 'activated' },
  { id: WREN_PROFILE, auth_user_id: WREN_SIGNIN, first_name: 'Wren', last_name: 'Tallow', user_type: 'student', account_status: 'activated' },
  { id: OTTO, auth_user_id: null, first_name: 'Otto', last_name: 'Pell', user_type: 'student', account_status: 'pending' },
];
const signIns = new Set([ME, WREN_SIGNIN]);

function fakeDb() {
  const inserted = [];
  return {
    inserted,
    from(table) {
      const st = { table, filters: [] };
      const q = {
        select() { return q; }, limit() { return q; }, maybeSingle() { st.single = true; return q; },
        order() { return q; }, eq() { return q; }, in() { return q; },
        or(f) { st.filters.push(f); return q; },
        insert(rows) { st.insert = rows; return q; },
        update() { return q; },
        then(resolve) {
          if (st.insert) {
            const r = st.insert[0];
            if (!signIns.has(r.recipient_id)) {
              return resolve({ data: null, error: { code: '23503', message: 'insert refused' } });
            }
            inserted.push(r);
            return resolve({ data: null, error: null });
          }
          if (table === 'user_profiles') {
            const f = st.filters.join(',');
            const rows = profiles.filter(p => f.includes(p.id) || (p.auth_user_id && f.includes(p.auth_user_id)));
            return resolve({ data: st.single ? rows[0] || null : rows, error: null });
          }
          if (table === 'messages') return resolve({ data: inserted.map(r => ({ ...r, created_at: new Date().toISOString() })), error: null });
          resolve({ data: null, error: null });
        },
      };
      return q;
    },
  };
}

function makeApp(db) {
  const app = {
    auth: { supabase: db },
    supabaseQuery: fn => fn(),
    userInfo: { user: { id: ME }, profile: { id: ME, first_name: 'Hazel', last_name: 'Marsh', user_type: 'teacher' } },
    messageThreads: [],
    notes: [],
    showNotification(m, kind) { this.notes.push([kind, m]); },
    createNotificationFor() {}, _resolveNotifyUserId: async id => id,
    renderMessages() {}, updateNavigationBadges() {}, showConversationModal(t) { this.opened = t; },
  };
  for (const name of ['loadMessageRecipientProfile', 'requireActiveMessageRecipient', 'isInactiveMessageRecipient',
    'messageAddressOf', 'messageIdsOf', '_messageSendError', 'sendMessageInThread', 'loadMessages', 'openConversation']) {
    app[name] = method(name);
  }
  return app;
}

(async () => {
  const db = fakeDb();
  const app = makeApp(db);
  const quiet = console.log, quietErr = console.error, quietWarn = console.warn;
  console.log = console.error = console.warn = () => {};
  let text = 'Hello Wren';
  global.document = { getElementById: id => id === 'conversation-message' ? { get value() { return text; }, set value(v) { text = v; } } : null };
  try {
    // 1. Picking the student by PROFILE id delivers to their sign-in id.
    await app.sendMessageInThread(WREN_PROFILE);
    assert.equal(db.inserted.length, 1, 'message stored');
    assert.equal(db.inserted[0].recipient_id, WREN_SIGNIN);
    assert(!app.notes.some(([k]) => k === 'error'), JSON.stringify(app.notes));

    // 2. The conversation list names them, and opening from the profile id finds it.
    await app.loadMessages();
    assert.equal(app.messageThreads.length, 1);
    assert.equal(app.messageThreads[0].profile.first_name, 'Wren', 'not "Unknown User"');
    await app.openConversation(WREN_PROFILE);
    assert.equal(app.opened.messages.length, 1, 'the thread with the message, not an empty one');

    // 3. A reply joins the same thread.
    text = 'Second note';
    await app.sendMessageInThread(WREN_PROFILE);
    assert.equal(db.inserted[1].thread_id, db.inserted[0].thread_id);

    // 4. No sign-in at all: a clear sentence, not the database error.
    app.notes = [];
    text = 'Hi Otto';
    await app.sendMessageInThread(OTTO);
    assert.equal(db.inserted.length, 2, 'nothing stored');
    const err = app.notes.find(([k]) => k === 'error')?.[1] || '';
    assert.match(err, /Otto Pell has no portal sign-in yet/);
    assert.doesNotMatch(err, /refused/);

    // 5. Same-id people are untouched.
    assert.equal(app.messageAddressOf(profiles[0]), ME);
    assert.equal(app.messageAddressOf({ id: ME }), ME, 'a profile read without auth_user_id keeps its id');
  } finally {
    console.log = quiet; console.error = quietErr; console.warn = quietWarn;
    delete global.document;
  }
  console.log('Messages: split-id students get messages, are named in the list, and no-sign-in is said plainly.');
})().catch(e => { console.error(e); process.exitCode = 1; });
