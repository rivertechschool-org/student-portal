// Grade planning must not depend on which enrollments fit in the API's first page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync(require('node:path').join(__dirname, '../portal/index.html'), 'utf8');
function method(name) {
  const start = html.search(new RegExp('\\n    (async )?' + name + '\\('));
  const end = name === '_rtErr' ? html.indexOf('\n', start + 1) - 7 : html.indexOf('\n    }\n', start);
  return eval('(' + html.slice(start, end + 7).trim().replace(/^(async )?\w+\(/, (_, a) => (a || '') + 'function(') + ')');
}
function fixture({ failure, missing = false } = {}) {
  const reads = [];
  const app = {
    reads, _rivenCurrentQuarter: async () => ({id:'quarter',name:'Test quarter'}),
    _rtResolveStudent: ref => ({student:{id:ref,full_name:ref}}),
    _rtResolveClassSpec: async () => ({row:{id:'class',name:'Sample class'}}),
    _letterToPct: () => 88, _pctToLetter: () => 'B+', escapeHtml: String,
    _requestConfirmation() { this.confirmed = true; },
    auth:{supabase:{from(table) {
      const filters = {};
      const q = {
        select(){return q},eq(k,v){filters[k]=v;return q},order(){return q},limit(){return q},
        async maybeSingle(){
          reads.push({table,filters});
          if(failure === table) return {data:null,error:{message:'Synthetic read failure'}};
          if(table === 'class_enrollments') {
            assert.equal(filters.class_id,'class');
            assert(filters.student_id, 'must filter the student before the row limit');
            assert.equal(filters.status,'active');
            return {data:missing?null:{id:'enrollment-'+filters.student_id},error:null};
          }
          assert(filters.enrollment_id.startsWith('enrollment-'));
          assert.equal(filters.quarter_id,'quarter');
          return {data:{academic_grade:70,participation_grade:75},error:null};
        },
        then(){throw Error('Unscoped school-wide fetch would truncate at 1000 rows');}
      };
      return q;
    }}}
  };
  for(const name of ['_rtPlan','_rtApply','_rtErr','_rtErrFor']) app[name]=method(name);
  return app;
}
const ops = Array.from({length:15},(_,i)=>['academic','participation'].map(component=>({op:'grade',student:'sample-'+i,class:'class',component,value:88}))).flat();
(async()=>{
  const app=fixture();
  const plan=await app._rtPlan({ops});
  assert.equal(plan.ok,true);
  assert.equal(plan.steps_planned,30);
  assert.equal(app.reads.length,30,'one enrollment and one snapshot read per student, cached across components');
  assert.equal(plan.steps[0].before,'70 (B+)');
  await app._rtApply({ops,reads:[]});
  assert.equal(app.confirmed,true);
  for(const opts of [{failure:'class_enrollments'},{failure:'quarter_grade_snapshots'},{missing:true}]) {
    const app=fixture(opts);
    const result=await app._rtApply({ops:[ops[0]]});
    assert.equal(result.blocked,true);
    assert.equal(result.executed,false);
    assert.equal(app.confirmed,undefined);
    assert.equal(result.errors[0].error,opts.missing?'not_enrolled':'read_failed');
    assert.equal(result.note,'Nothing was written. Fix these and re-send.');
  }
  console.log('PASS: scoped enrollment checks, cached grade snapshots, 30-operation plan, read failures and blocked apply message');
})().catch(e=>{console.error(e);process.exitCode=1});
