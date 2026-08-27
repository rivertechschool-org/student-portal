/**
 * Academic Credit Policy 1.2 — client-side credit resolution.
 *
 * Mirrors rt_effective_credit() in the backend repo's
 * zzzzzzzzzz_credit_policy_2026_27.sql. The portal computes report cards and
 * transcripts client-side from already-fetched enrollment rows, so resolving
 * per enrollment over RPC would be an N+1. Instead the grid (about three dozen
 * rows) is fetched once and applied here.
 *
 * KEEP THE TWO IN STEP. If you change the precedence or the pattern
 * derivation, change it in the SQL function too — that function is the one an
 * admin query or a future server-side report will use, and a transcript that
 * disagrees with the database is worse than either answer alone.
 *
 * Degrades safely: with no credit_policy rows loaded, or a class whose
 * credit_subject is unset, every call returns the legacy
 * `credits_override ?? classes.credits ?? 1`. So this file is inert until the
 * migration is applied and classes are mapped to policy subjects.
 */
(function (global) {
  'use strict';

  var ARTS_SUBJECTS = [
    'arts_monday_production',
    'arts_monday_alternative',
    'arts_instruments_dance',
    'arts_fine_arts'
  ];

  // Technology is itemized on the transcript by policy s4 — a named course in
  // coding or robotics reads as a demonstrable skill. Listed for callers that
  // need to know which subjects are technology.
  var TECH_SUBJECTS = ['coding_ai', 'robotics'];

  var state = {
    loaded: false,
    rules: [],
    settings: {
      graduation_credits: 46,
      annual_target_credits: 12,
      policy_effective_year: 2026,
      transcript_statement:
        "Credits are assigned under River Tech School's Academic Credit Policy, " +
        'which weights instructional time by academic rigor.'
    }
  };

  /** Fetch the grid and settings once. Safe to call repeatedly. */
  async function load(supabase) {
    if (state.loaded) return state;
    try {
      var res = await Promise.all([
        supabase.from('credit_policy').select('*'),
        supabase.from('credit_settings').select('*').limit(1).maybeSingle()
      ]);
      if (!res[0].error && Array.isArray(res[0].data)) state.rules = res[0].data;
      if (!res[1].error && res[1].data) {
        Object.assign(state.settings, res[1].data);
      }
      state.loaded = true;
    } catch (e) {
      // Leave state.loaded false so a later call can retry; callers fall back
      // to legacy credit in the meantime rather than showing a wrong number.
      console.warn('[credit-policy] could not load grid, using legacy credits:', e);
    }
    return state;
  }

  /**
   * Policy attendance pattern from the registrar's day flags.
   * Monday and Friday are the only discriminating days — Tue/Wed/Thu are
   * attended on every pattern — so an off-pattern schedule still resolves to a
   * usable pattern instead of falling out of the grid. Day-specific courses are
   * gated separately by requires_day.
   */
  function pattern(profile) {
    if (!profile) return null;
    var mon = profile.attends_monday !== false;
    var fri = profile.attends_friday !== false;
    if (mon && fri) return 'five_day';
    if (mon && !fri) return 'mon_thu';
    if (!mon && fri) return 'tue_fri';
    return 'mon_thu';
  }

  function attendsDay(profile, day) {
    if (!profile || !day) return true;
    switch (day) {
      case 'mon': return profile.attends_monday !== false;
      case 'tue': return profile.attends_tuesday !== false;
      case 'wed': return profile.attends_wednesday !== false;
      case 'thu': return profile.attends_thursday !== false;
      case 'fri': return profile.attends_friday !== false;
      default: return true;
    }
  }

  function startYear(schoolYear) {
    if (!schoolYear) return null;
    var m = String(schoolYear).match(/\d{4}/);
    return m ? parseInt(m[0], 10) : null;
  }

  /** Most specific matching rule wins, exactly as the SQL ORDER BY does. */
  function findRule(subject, pat, grade, performer, year) {
    var best = null;
    var bestSpec = -1;
    for (var i = 0; i < state.rules.length; i++) {
      var r = state.rules[i];
      if (r.subject_key !== subject) continue;
      if (r.pattern !== null && r.pattern !== undefined && r.pattern !== pat) continue;
      if (r.grade_level !== null && r.grade_level !== undefined && Number(r.grade_level) !== Number(grade)) continue;
      if (r.performer !== null && r.performer !== undefined && r.performer !== !!performer) continue;
      if (year != null && Number(r.effective_from_year) > year) continue;
      var spec =
        (r.pattern != null ? 1 : 0) +
        (r.grade_level != null ? 1 : 0) +
        (r.performer != null ? 1 : 0);
      if (spec > bestSpec) { best = r; bestSpec = spec; }
    }
    return best;
  }

  function legacy(enrollment, cls) {
    var o = enrollment && enrollment.credits_override;
    if (o !== null && o !== undefined) return Number(o);
    var c = cls && cls.credits;
    return c !== null && c !== undefined ? Number(c) : 1;
  }

  /**
   * Credit earned for one enrollment.
   * Precedence: credits_override > policy grid > classes.credits > 1.
   *
   * @param {object} enrollment class_enrollments row (needs credits_override)
   * @param {object} cls        classes row (needs credits, credit_subject)
   * @param {object} profile    student user_profiles row (day flags, grade_level, arts_performer)
   * @param {string} schoolYear e.g. "2026-2027"; policy applies from its start year
   */
  var WEEKDAYS = [
    ['meets_monday', 'attends_monday'],
    ['meets_tuesday', 'attends_tuesday'],
    ['meets_wednesday', 'attends_wednesday'],
    ['meets_thursday', 'attends_thursday'],
    ['meets_friday', 'attends_friday']
  ];

  function effective(enrollment, cls, profile, schoolYear) {
    // 1. An explicit per-student value always wins. This is the a la carte path
    //    for Cooking, Drawing and Traditional Art.
    var override = enrollment && enrollment.credits_override;
    if (override !== null && override !== undefined) return Number(override);

    // 2. Policy 9: records before the effective year keep their issued value.
    var year = startYear(schoolYear);
    if (year != null && year < Number(state.settings.policy_effective_year)) {
      return legacy(enrollment, cls);
    }

    // 3. Primary mechanism: the class carries what it is worth at full
    //    attendance; credit is adjusted for the days this student attends.
    var weight = cls && cls.credit_weight;
    if (weight !== null && weight !== undefined && weight !== '') {
      weight = Number(weight);
      // Core subjects hold their value on any pattern (policy s3).
      if (cls.credit_scales_with_attendance === false) return weight;

      var total = 0, attended = 0;
      for (var d = 0; d < WEEKDAYS.length; d++) {
        if (!cls[WEEKDAYS[d][0]]) continue;
        total++;
        if (!profile || profile[WEEKDAYS[d][1]] !== false) attended++;
      }
      // No meeting days recorded: cannot prorate, so award full value rather
      // than silently zeroing a student's credit.
      if (total === 0) return weight;
      // Policy s3: these round to clean quarter- and half-credits.
      return Math.round((weight * attended / total) * 4) / 4;
    }

    // 4. No per-class weight -> fall back to the subject grid. This is the path
    //    the Annual Essay uses, since its value tracks grade level.
    var subject = cls && cls.credit_subject;
    if (!subject || !state.rules.length) return legacy(enrollment, cls);

    var rule = findRule(
      subject,
      pattern(profile),
      profile && profile.grade_level,
      profile && profile.arts_performer,
      year
    );
    if (!rule) return legacy(enrollment, cls);

    // 3. Day-gated course: the student must actually attend that day.
    if (rule.requires_day && !attendsDay(profile, rule.requires_day)) return 0;

    return Number(rule.credits);
  }

  /**
   * Policy s4: the arts are gathered under a single transcript heading, unless
   * the student has requested a concentration, in which case the individual
   * courses are shown by name so genuine depth is visible.
   */
  function shouldGroupArts(profile) {
    return !(profile && profile.arts_concentration);
  }

  function isArts(subject) { return ARTS_SUBJECTS.indexOf(subject) !== -1; }
  function isTech(subject) { return TECH_SUBJECTS.indexOf(subject) !== -1; }

  global.RTCredit = {
    load: load,
    effective: effective,
    pattern: pattern,
    isArts: isArts,
    isTech: isTech,
    shouldGroupArts: shouldGroupArts,
    ARTS_SUBJECTS: ARTS_SUBJECTS,
    TECH_SUBJECTS: TECH_SUBJECTS,
    get settings() { return state.settings; },
    get loaded() { return state.loaded; },
    // Test seam: lets a harness install a grid without a network round trip.
    _setRules: function (rules, settings) {
      state.rules = rules || [];
      if (settings) Object.assign(state.settings, settings);
      state.loaded = true;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
