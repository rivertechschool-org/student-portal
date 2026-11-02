// The same completed-quarter summary on both portals, for students and parents.
(function (root) {
  'use strict';
  const DURATION = 21 * 86400000;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  function reviewWindow(quarters, transition, now = new Date()) {
    const current = quarters.find(q => q.is_current);
    if (!current) return null;
    const recordedPrevious = transition?.current_quarter_id === current.id
      ? quarters.find(q => q.id === transition.previous_quarter_id && q.id !== current.id) : null;
    const previous = recordedPrevious || quarters.filter(q => q.id !== current.id && q.start_date < current.start_date)
      .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
    if (!previous) return null;
    const recorded = transition?.current_quarter_id === current.id && transition?.previous_quarter_id === previous.id;
    const started = new Date(recorded ? transition.switched_at : `${current.start_date.slice(0, 10)}T00:00:00`).getTime();
    const expires = started + DURATION;
    if (!Number.isFinite(started) || now.getTime() < started || now.getTime() >= expires) return null;
    return { quarter: previous, expires };
  }
  function quarterLabel(name) {
    const n = /(?:quarter\s*|q\s*)([1-4])\b/i.exec(name || '')?.[1]
      || /\b([1-4])(?:st|nd|rd|th)\b/i.exec(name || '')?.[1];
    return n ? `${['', '1st', '2nd', '3rd', '4th'][Number(n)]} Quarter` : name;
  }
  function render(review, people, snapshots, expanded = false) {
    const groups = people.map(person => {
      const rows = snapshots.filter(s => s.class_enrollments?.student_id === person.id
        && s.class_grade != null && Number.isFinite(Number(s.class_grade)) && Number(s.class_grade) > 0)
        .sort((a, b) => (a.class_enrollments.classes?.name || '').localeCompare(b.class_enrollments.classes?.name || ''));
      if (!rows.length) return '';
      const shown = expanded ? rows : rows.slice(0, 3);
      return `${person.name ? `<h3>${escape(person.name)}</h3>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:12px 0;">
        ${shown.map(s => {
          const cls = s.class_enrollments;
          const href = `/portal/?go=quarter-assignments&class=${encodeURIComponent(cls.class_id)}&quarter=${encodeURIComponent(review.quarter.id)}&student=${encodeURIComponent(person.id)}`;
          return `<a href="${escape(href)}" style="display:block;padding:16px;border:1px solid var(--border);border-radius:10px;color:var(--text);text-decoration:none;">
            <strong>${escape(cls.classes?.name || 'Class')}</strong>
            <div style="font-size:24px;font-weight:700;color:var(--accent);margin-top:8px;">${Number(s.class_grade).toFixed(1)}%</div>
            <small>View assignments →</small></a>`;
        }).join('')}</div>`;
    }).filter(Boolean);
    if (!groups.length) return '';
    return `<h2 style="margin-top:0;">${escape(quarterLabel(review.quarter.name))} is over! Take a look at your grades.</h2>
      ${groups.join('')}<button type="button" class="btn btn-secondary" data-quarter-review-toggle aria-expanded="${expanded}">${expanded ? 'Show fewer classes' : 'View all classes'}</button>`;
  }
  async function allRows(build) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) return rows;
    }
  }
  async function mount(auth, element) {
    if (!element) return;
    const info = auth.getUserInfo();
    const role = info?.profile?.user_type;
    if (!['student', 'parent'].includes(role)) return;
    const sb = auth.supabase;
    try {
      const [quartersResult, settingsResult] = await Promise.all([
        sb.from('quarters').select('id, name, start_date, end_date, is_current'),
        sb.from('school_settings').select('value').eq('key', 'quarter_grade_review_transition').maybeSingle(),
      ]);
      if (quartersResult.error) throw quartersResult.error;
      let transition = null;
      if (settingsResult.error) throw settingsResult.error;
      try { transition = JSON.parse(settingsResult.data?.value || 'null'); } catch (_) { /* legacy data */ }
      const review = reviewWindow(quartersResult.data || [], transition);
      if (!review) return;
      let people;
      if (role === 'student') people = [{ id: auth.studentRecordId() }];
      else {
        const { data: links, error } = await sb.from('parent_child_links').select('child_id').eq('parent_id', info.user.id);
        if (error) throw error;
        const ids = [...new Set((links || []).map(l => l.child_id))];
        if (!ids.length) return;
        people = await allRows((from, to) => sb.from('user_profiles').select('id, first_name, last_name').in('id', ids).order('id').range(from, to));
        people = people.map(p => ({ id: p.id, name: `${p.first_name || ''} ${p.last_name || ''}`.trim() }));
      }
      if (!people.length) return;
      const snapshots = await allRows((from, to) => sb.from('quarter_grade_snapshots')
        .select('class_grade, enrollment_id, class_enrollments!inner(student_id, class_id, classes(id, name))')
        .eq('quarter_id', review.quarter.id).in('class_enrollments.student_id', people.map(p => p.id))
        .order('enrollment_id').range(from, to));
      if (!element.isConnected) return;
      let expanded = false;
      const draw = () => {
        element.innerHTML = render(review, people, snapshots, expanded);
        element.hidden = !element.innerHTML;
      };
      draw();
      element.onclick = event => {
        if (!event.target.closest('[data-quarter-review-toggle]')) return;
        expanded = !expanded;
        draw();
      };
      // A Home left open across the deadline must stop showing the announcement.
      setTimeout(() => { element.hidden = true; element.innerHTML = ''; }, Math.max(0, review.expires - Date.now()));
    } catch (error) {
      console.warn('Completed-quarter grades unavailable:', error.message || error);
    }
  }
  root.QuarterReview = { mount, reviewWindow, quarterLabel, render };
  if (typeof module !== 'undefined') module.exports = root.QuarterReview;
})(typeof window === 'undefined' ? globalThis : window);
