/* Word Lab bridge: English Lyceum's vocabulary system <-> the database.
 *
 * Games never sign in; the page that hosts them (index.html, portal/index.html)
 * owns the session. Lyceum's Word Lab posts these messages to its host, and this
 * file answers them by calling the Word Lab functions as the signed-in student.
 * One file for both hosts, so the two never disagree about what Word Lab saves.
 *
 *   game -> host                                    host -> game
 *   VOCAB_LOAD        {reqId}                       VOCAB_STATE   {reqId, ok, state}
 *   VOCAB_RECORD      {reqId, results:[{word,grade,right}]}
 *   VOCAB_PLACEMENT   {reqId, grade, detail}
 *   VOCAB_SET_LEVEL   {reqId, grade, level}
 *   VOCAB_PASS_LEVEL  {reqId, grade, level, score, nextGrade, nextLevel}
 *                                                   VOCAB_SAVED   {reqId, ok, error?}
 *
 * The host checks the message's origin before handing it here. The student is
 * whoever is signed in; nothing in the message says who.
 */
(function () {
  const RPC = {
    VOCAB_RECORD:     (d) => ['rt_vocab_record', { p_results: Array.isArray(d.results) ? d.results.slice(0, 200) : [] }],
    VOCAB_PLACEMENT:  (d) => ['rt_vocab_set_placement', { p_grade: String(d.grade), p_detail: d.detail || {} }],
    VOCAB_SET_LEVEL:  (d) => ['rt_vocab_set_level', { p_grade: String(d.grade), p_level: Number(d.level) }],
    VOCAB_PASS_LEVEL: (d) => ['rt_vocab_pass_level', {
      p_grade: String(d.grade), p_level: Number(d.level), p_score: Number(d.score),
      p_next_grade: String(d.nextGrade), p_next_level: Number(d.nextLevel) }],
  };

  function client() {
    const a = window.portalAuth;
    return a && a.supabase ? a.supabase : null;
  }

  // Returns true when the message was a Word Lab one (handled or not), so the
  // host can stop looking at it.
  function handle(event) {
    const d = event && event.data;
    if (!d || typeof d.type !== 'string' || d.type.indexOf('VOCAB_') !== 0) return false;
    const reply = (msg) => {
      try { event.source && event.source.postMessage(Object.assign({ reqId: d.reqId }, msg), window.location.origin); }
      catch (e) { console.warn('Word Lab: could not reply', e); }
    };
    const sb = client();
    if (!sb) {
      reply(d.type === 'VOCAB_LOAD' ? { type: 'VOCAB_STATE', ok: false, error: 'Not signed in' }
                                    : { type: 'VOCAB_SAVED', ok: false, error: 'Not signed in' });
      return true;
    }

    if (d.type === 'VOCAB_LOAD') {
      sb.rpc('rt_vocab_state').then(({ data, error }) => {
        if (error) { console.error('Word Lab: load failed', error); reply({ type: 'VOCAB_STATE', ok: false, error: error.message }); }
        else reply({ type: 'VOCAB_STATE', ok: true, state: data });
      });
      return true;
    }

    const make = RPC[d.type];
    if (!make) return true;
    const [fn, args] = make(d);
    sb.rpc(fn, args).then(({ error }) => {
      if (error) console.error('Word Lab: ' + fn + ' failed', error);
      reply({ type: 'VOCAB_SAVED', ok: !error, error: error ? error.message : undefined, what: d.type });
    });
    return true;
  }

  window.VocabBridge = { handle };
})();
