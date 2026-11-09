// Invented data only. Shared by the node regressions and browser journeys.
function pagesDatabase(seed, faults = {}) {
  const copy = x => JSON.parse(JSON.stringify(x));
  const tables = copy(seed), writes = [], calls = {};
  let sequence = 0;
  function from(table) {
    const filters = [], sorts = [];
    let op = 'select', input, single = false, lo = 0, hi = Infinity, head = false;
    const api = {
      select(c, opts) { head = opts?.head || false; return api; },
      eq(k,v) { filters.push(r => r[k] === v); return api; },
      is(k,v) { filters.push(r => (r[k] ?? null) === v); return api; },
      in(k,vs) { filters.push(r => vs.includes(r[k])); return api; },
      gte(k,v) { filters.push(r => r[k] >= v); return api; },
      lte(k,v) { filters.push(r => r[k] <= v); return api; },
      or(expr) { if (expr.includes('neq.info')) filters.push(r => r.assignment_type !== 'info'); return api; },
      order(k,opts) { sorts.push([k,opts?.ascending !== false]); return api; },
      range(a,b) { lo=a;hi=b;return api; }, limit(n) { hi=n-1;return api; },
      single() { single=true;return api; }, maybeSingle() { single=true;return api; },
      insert(row) { op='insert';input=copy(row);return api; },
      upsert(row) { op='upsert';input=copy(row);return api; },
      update(row) { op='update';input=copy(row);return api; },
      delete() { op='delete';return api; },
      then(resolve,reject) {
        const key = `${table}:${op}`;
        calls[key] = (calls[key] || 0) + 1;
        if (faults[key] === calls[key]) return Promise.resolve({ data:null,error:{message:'simulated '+key} }).then(resolve,reject);
        const all = tables[table] ||= [];
        let rows = all.filter(r => filters.every(f => f(r)));
        if (op === 'insert' || op === 'upsert') {
          rows = [].concat(input).map(row => {
            let saved = op === 'upsert' && all.find(r => r.assignment_id === row.assignment_id && r.student_id === row.student_id);
            if (saved) Object.assign(saved,row);
            else { saved = { id:'new-'+(++sequence), ...(table === 'assignments' ? { is_template:false } : {}), ...row };all.push(saved); }
            return saved;
          });
        } else if (op === 'update') rows.forEach(r => Object.assign(r,input));
        else if (op === 'delete') {
          tables[table] = all.filter(r => !rows.includes(r));
          if (table === 'assignments') for (const child of ['assignment_student_versions','assignment_students']) {
            tables[child] = (tables[child] || []).filter(r => !rows.some(a => a.id === r.assignment_id));
          }
        }
        if (op !== 'select') writes.push({table,op,input:copy(input ?? null),ids:rows.map(r=>r.id)});
        for (const [k,asc] of [...sorts].reverse()) rows.sort((a,b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0)*(asc?1:-1));
        const count=rows.length;
        rows=rows.slice(lo,hi+1);
        return Promise.resolve({data:head?null:copy(single ? rows[0] || null : rows), count, error:null}).then(resolve,reject);
      }
    };
    return api;
  }
  return {from,tables,writes,calls};
}
function pagesSeed() {
  return {
    assignments:[{id:'old',class_id:'math',title:'Workbook',grading_type:'points',max_points:20,assignment_type:'regular',assigned_to_all:true,is_published:true,due_date:'2026-11-06T16:00:00.000Z'}],
    assignment_student_versions:[{id:'v1',assignment_id:'old',student_id:'ivy',page_start:27,page_end:30},
      {id:'v2',assignment_id:'old',student_id:'oren',page_start:10,page_end:15}],
    user_profiles:[{id:'ivy',auth_user_id:'login-ivy',first_name:'Ivy',last_name:'Marsh'},
      {id:'oren',auth_user_id:'login-oren',first_name:'Oren',last_name:'Pike'}],
    class_enrollments:[{id:'e1',class_id:'math',student_id:'ivy',status:'active'}, {id:'e2',class_id:'math',student_id:'oren',status:'active'}],
    assignment_submissions:[{id:'s1',assignment_id:'old',student_id:'login-ivy',content:'Pgs 26-29',status:'submitted',grade:null,grade_override:false,submitted_at:'2026-11-06T15:00:00.000Z'},
      {id:'s2',assignment_id:'old',student_id:'oren',content:'10-15',status:'graded',grade:'A',grade_override:true,submitted_at:'2026-11-06T15:00:00.000Z'}],
    quarters:[{id:'q',name:'Fall',is_current:true,is_archived:false,start_date:'2026-09-01T00:00:00.000Z',end_date:'2026-12-20T00:00:00.000Z'}],
    grade_categories:[],rubrics:[],assignment_students:[]
  };
}
module.exports={pagesDatabase,pagesSeed};
