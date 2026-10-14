/* Recall bridge: Math Dojo's Retention Gauntlet and English Lyceum's Recall
 * Trials <-> the database.
 *
 * A recall run defends skills the student already has. The game asks its host
 * for a line-up, plays it, and reports what was cleared and what was missed;
 * the host saves the result (a demotion for a missed mastered skill, practice
 * recorded, RTC for clears) and tells the game what it paid.
 *
 *   game -> host                                    host -> game
 *   DOGO_REQUEST_WEEKLY_MASTERIES {subject}         WEEKLY_MASTERIES_FOR_DOGO {skills}
 *   DOGO_GAUNTLET_COMPLETE {subject, cleared, failed, correctCount, questionsAsked, durationMs}
 *                                                   GAUNTLET_RTC_RESULT {amount, ...}
 *
 * This used to live only on the student site (index.html). Lyceum launched
 * from the portal - homework - asked and got no answer, so Recall there
 * spun on "Calculating RTC reward…" and saved nothing. Both hosts now use
 * this one file: index.html through its existing methods, the portal through
 * handle(), so the two can never disagree about what a recall run does.
 */
(function () {
  const DAY = 86400000;

  // The line-up: 21 slots in three buckets of 7, from skill_progress rows.
  //   recent     mastered within the last 14 days (top of mind)
  //   touch_on   in_progress, or mastered with stale practice (8-30 days)
  //   retention  mastered long ago, practice over 30 days stale
  function lineup(rows, now = Date.now()) {
    const recent = [], touchOn = [], retention = [];
    (rows || []).forEach(row => {
      if (!row.skill_name) return;
      const lp = row.last_practiced ? new Date(row.last_practiced).getTime() : 0;
      const mst = row.mastered_at ? new Date(row.mastered_at).getTime() : 0;
      const daysSinceMaster = mst ? (now - mst) / DAY : Infinity;
      const daysSincePractice = lp ? (now - lp) / DAY : Infinity;
      if (row.state === 'mastered' || row.state === 'activated') {
        if (daysSinceMaster <= 14) recent.push({ ...row, _sort: -daysSinceMaster });
        else if (daysSincePractice >= 30) retention.push({ ...row, _sort: daysSincePractice });
        else if (daysSincePractice >= 8) touchOn.push({ ...row, _sort: daysSincePractice });
        else recent.push({ ...row, _sort: -daysSincePractice });
      } else if (row.state === 'in_progress') {
        touchOn.push({ ...row, _sort: 1000 });   // in_progress at the top of touch_on
      }
    });
    recent.sort((a, b) => b._sort - a._sort);
    touchOn.sort((a, b) => b._sort - a._sort);
    retention.sort((a, b) => b._sort - a._sort);
    const used = new Set();
    const pickN = (arr, n, category) => {
      const out = [];
      for (const r of arr) {
        if (out.length >= n) break;
        if (used.has(r.skill_name)) continue;
        used.add(r.skill_name);
        out.push({ skill: r.skill_name, tier: 1, category });
      }
      return out;
    };
    const base = [...pickN(recent, 7, 'recent'), ...pickN(touchOn, 7, 'touch_on'), ...pickN(retention, 7, 'retention')];
    // Pad to 21 by cycling: each slot is its own 3-in-a-row streak. RTC is
    // gated by the per-skill 24h cooldown in complete(), so repeats can't
    // double-pay.
    const skills = [];
    if (base.length) for (let i = 0; i < 21; i++) skills.push(base[i % base.length]);
    return skills;
  }

  async function sendLineup(sb, userId, subject, target) {
    const reply = (skills) => { try { target && target.postMessage({ type: 'WEEKLY_MASTERIES_FOR_DOGO', skills }, '*'); } catch (_) {} };
    try {
      if (!sb || !userId) return reply([]);
      const { data, error } = await sb.from('skill_progress')
        .select('skill_name, state, mastery_score, last_practiced, mastered_at, practice_count')
        .eq('user_id', userId).eq('subject', subject);
      if (error) { console.error('Recall: could not load skills for the line-up:', error); return reply([]); }
      reply(lineup(data));
    } catch (e) {
      console.error('Recall: line-up failed:', e);
      reply([]);
    }
  }

  // One entry per skill. A skill that cleared in ANY slot counts as cleared
  // and is dropped from failed: the line-up pads repeats, and a later miss
  // must not undo an earned clear.
  function dedupe(cleared, failed) {
    const k = (s) => s && (s.skill || s.domain);
    const uniq = (arr) => {
      const seen = new Set(), out = [];
      for (const s of (Array.isArray(arr) ? arr : [])) { const x = k(s); if (!x || seen.has(x)) continue; seen.add(x); out.push(s); }
      return out;
    };
    const c = uniq(cleared);
    const ck = new Set(c.map(k));
    return { cleared: c, failed: uniq(failed).filter(s => !ck.has(k(s))) };
  }

  // What a recall run may write. It only touches skills that already have a
  // row (`existing`, freshly read), and:
  //   cleared + mastered/activated -> state kept, score raised to >= 90
  //   cleared + anything else      -> practice recorded, state unchanged
  //   failed  + mastered           -> activated, score capped at 70
  //   failed  + activated          -> score capped at 70
  //   failed  + anything else      -> practice recorded, never promoted
  // `existing` null means the lookup failed: write nothing rather than guess.
  function planRows(userId, subject, cleared, failed, existing, now) {
    const rows = [];
    if (!existing) return rows;
    const base = (name, prev) => ({ user_id: userId, subject, skill_name: name, last_practiced: now,
      practice_count: (prev.practice_count || 0) + 1, source: 'recall', updated_at: now });
    for (const c of cleared) {
      const name = c.skill || c.domain; const prev = existing.get(name); if (!prev) continue;
      const row = { ...base(name, prev), state: prev.state, mastery_score: prev.mastery_score || 0 };
      if (prev.state === 'mastered' || prev.state === 'activated') row.mastery_score = Math.max(prev.mastery_score || 0, 90);
      rows.push(row);
    }
    for (const f of failed) {
      const name = f.skill || f.domain; const prev = existing.get(name); if (!prev) continue;
      const row = { ...base(name, prev), state: prev.state, mastery_score: prev.mastery_score || 0 };
      if (prev.state === 'mastered') { row.state = 'activated'; row.mastery_score = Math.min(prev.mastery_score || 70, 70); }
      else if (prev.state === 'activated') row.mastery_score = Math.min(prev.mastery_score || 70, 70);
      rows.push(row);
    }
    return rows;
  }

  // Saves a finished run. hooks.onRows(rows, subject, now) lets a host update
  // its own cache; hooks.reply(msg) sends GAUNTLET_RTC_RESULT back.
  async function complete(sb, userId, data, hooks = {}) {
    const subject = data.subject || 'Math';
    const now = new Date().toISOString();
    const { cleared, failed } = dedupe(data.cleared, data.failed);
    // Shapes the projection the game shows; the amount minted is decided
    // server-side by award_skill_gauntlet_rtc (with its own daily caps).
    const PER_CATEGORY_RTC = { recent: 3, touch_on: 2, retention: 1 };

    // Per-skill 24h cooldown, from the recall session log.
    const dayAgo = new Date(Date.now() - DAY).toISOString();
    const recentlyRewarded = new Set();
    try {
      const { data: runs } = await sb.from('math_dojo_sessions').select('skill_details')
        .eq('user_id', userId).eq('subject', subject).eq('mode', 'retention').gte('created_at', dayAgo);
      (runs || []).forEach(run => (Array.isArray(run.skill_details) ? run.skill_details : [])
        .forEach(d => { if (d && d.cleared) recentlyRewarded.add(d.skill || d.domain); }));
    } catch (_) {}

    const names = [...new Set([...cleared, ...failed].map(s => s.skill || s.domain).filter(Boolean))];
    let existing = null;
    if (names.length) {
      try {
        const { data: rows, error } = await sb.from('skill_progress')
          .select('skill_name, state, mastery_score, practice_count, mastered_at')
          .eq('user_id', userId).eq('subject', subject).in('skill_name', names);
        if (error) console.error('Recall: could not read existing skills, writing nothing:', error);
        else existing = new Map((rows || []).map(r => [r.skill_name, r]));
      } catch (e) { console.error('Recall: could not read existing skills, writing nothing:', e); }
    } else existing = new Map();

    const rows = planRows(userId, subject, cleared, failed, existing, now);
    if (rows.length) {
      try { hooks.onRows && hooks.onRows(rows, subject, now); } catch (_) {}
      const { error } = await sb.from('skill_progress').upsert(rows, { onConflict: 'user_id,subject,skill_name' });
      if (error) console.error('Failed to save recall results:', error);
    }

    const eligible = cleared.filter(c => { const n = c.skill || c.domain; return existing && existing.has(n) && !recentlyRewarded.has(n); });
    const skippedCooldown = cleared.filter(c => recentlyRewarded.has(c.skill || c.domain)).length;
    let amount = 0;
    if (eligible.length) {
      try {
        const { data: awarded, error } = await sb.rpc('award_skill_gauntlet_rtc', { p_skill_count: eligible.length });
        if (error) console.error('Failed to award recall RTC:', error); else amount = Number(awarded) || 0;
      } catch (e) { console.error('Recall RTC unavailable, awarding 0:', e); }
    }

    // The session log: the weekly card reads it, and so does the next cooldown.
    try {
      const stateOf = (n) => { const r = rows.find(x => x.skill_name === n); return r ? r.state : null; };
      const skillDetails = [
        ...cleared.map(c => ({ skill: c.skill, domain: c.domain, tier: c.tier, state: stateOf(c.skill || c.domain), cleared: true })),
        ...failed.map(f => ({ skill: f.skill, domain: f.domain, tier: f.tier, state: stateOf(f.skill || f.domain), cleared: false })),
      ];
      await sb.from('math_dojo_sessions').insert({
        user_id: userId, subject, mode: 'retention', skills_practiced: skillDetails.length,
        total_correct: Number(data.correctCount) || 0, total_questions: Number(data.questionsAsked) || 0,
        skill_details: skillDetails, duration_seconds: Math.round((Number(data.durationMs) || 0) / 1000),
      });
    } catch (e) { console.error('Failed to record recall session:', e); }

    const result = { type: 'GAUNTLET_RTC_RESULT', amount, perCategoryRtc: PER_CATEGORY_RTC,
      rewardedByCategory: { recent: 0, touch_on: 0, retention: 0 }, skippedCooldown,
      eligibleCount: eligible.length, clearedCount: cleared.length };
    try { hooks.reply && hooks.reply(result); } catch (_) {}
    return result;
  }

  // For a host with no recall handlers of its own (the portal). The host has
  // already checked the message's origin. The student is whoever is signed in.
  function handle(event) {
    const d = event && event.data;
    if (!d || (d.type !== 'DOGO_REQUEST_WEEKLY_MASTERIES' && d.type !== 'DOGO_GAUNTLET_COMPLETE')) return false;
    const auth = window.portalAuth;
    const sb = auth && auth.supabase;
    let userId = null;
    try { userId = auth && auth.getUserInfo && auth.getUserInfo().profile && auth.getUserInfo().profile.id; } catch (_) {}
    const reply = (msg) => { try { event.source && event.source.postMessage(msg, '*'); } catch (_) {} };
    if (d.type === 'DOGO_REQUEST_WEEKLY_MASTERIES') {
      if (!sb || !userId) reply({ type: 'WEEKLY_MASTERIES_FOR_DOGO', skills: [] });
      else sendLineup(sb, userId, d.subject || 'Math', event.source);
      return true;
    }
    if (!sb || !userId) { reply({ type: 'GAUNTLET_RTC_RESULT', amount: 0, clearedCount: 0, unsaved: true }); return true; }
    complete(sb, userId, d, { reply }).catch(e => console.error('Recall: save failed:', e));
    return true;
  }

  window.RecallBridge = { lineup, sendLineup, dedupe, planRows, complete, handle };
})();
