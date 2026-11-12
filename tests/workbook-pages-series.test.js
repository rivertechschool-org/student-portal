// Real portal methods; no network or school data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { pagesDatabase, pagesSeed } = require('./workbook-pages-fixtures');
const html = fs.readFileSync(require('node:path').join(__dirname,'../portal/index.html'),'utf8');
function method(name) {
  const start=html.search(new RegExp('\\n      (?:async )?'+name+'\\('));
  assert(start>=0,name);
  // Methods finish at this indentation; nested blocks do not.
  const end=html.indexOf('\n      }',start);
  return html.slice(start,end+8).trim();
}
const names=['_pagesSeriesPlan','_seriesTitle','_seriesDue','_seriesWeekOf','_seriesPlan','_pagesNextLabel','_pagesCreateSeries','_pagesGroupCards','_pagesRecoveryGrade','_pagesLoadTargets','_pagesHasTargets','_pagesInit','_pagesFillFromPrevious','_pagesPlan','_pagesRepairAssignment'];
function app(db) { return Object.assign(eval(`({${names.map(method).join(',')}})`),{
  auth:{supabase:db},supabaseQuery:fn=>fn(),escapeHtml:s=>String(s).replaceAll('<','&lt;'),jsAttr:s=>s,
  sendNewAssignmentNotifications:async()=>{},showNotification:()=>{},viewAssignments:async()=>{},
  userInfo:{profile:{user_type:'teacher'}}
}); }
(async()=>{
  let db=pagesDatabase(pagesSeed()),a=app(db);
  const base={title:'Practice',due_date:'2026-11-13T16:00:00Z',class_id:'math',is_published:true,assigned_to_all:false,pages_continues_from:'old',grading_type:'pages'};
  const targets=[{student_id:'ivy',page_start:31,page_end:34,page_label:null},{student_id:'oren',page_start:16,page_end:21,page_label:null}];
  const plan=a._pagesSeriesPlan(base,targets,3);
  assert.deepEqual(plan.map(w=>w.targets.map(t=>[t.page_start,t.page_end])),[[[31,34],[16,21]],[[35,38],[22,27]],[[39,42],[28,33]]]);
  assert.equal(plan[2].assignment.due_date,'2026-11-27T16:00:00.000Z');
  assert.equal(targets[0].page_start,31,'planning does not mutate input');
  for(const n of [0,-1,1.5,53,NaN]) assert.throws(()=>a._pagesSeriesPlan(base,targets,n));
  assert.equal(a._pagesSeriesPlan(base,[{student_id:'ivy',page_label:'Week 3'}],3)[2].targets[0].page_label,'Week 5');
  assert.throws(()=>a._pagesSeriesPlan(base,[{student_id:'ivy',page_label:'3-A'}],2));
  assert.throws(()=>a._pagesSeriesPlan(base,[{student_id:'ivy',page_start:4998,page_end:5000}],2));
  const oldTZ=process.env.TZ;process.env.TZ='America/Los_Angeles';
  assert.equal(a._pagesSeriesPlan({...base,due_date:'2026-10-30T23:00:00Z'},targets,2)[1].assignment.due_date,'2026-11-07T00:00:00.000Z','weekly due time survives daylight saving');
  if (oldTZ===undefined) delete process.env.TZ;else process.env.TZ=oldTZ;
  const ids=await a._pagesCreateSeries(plan);
  assert.equal(ids.length,3);assert.equal(db.tables.assignment_students.length,6);
  assert.deepEqual(db.tables.assignments.slice(1).map(w=>w.pages_continues_from),['old',ids[0],ids[1]]);
  assert(db.tables.assignments.slice(1).every(w=>w.is_published));
  assert(db.writes.filter(w=>w.table==='assignments'&&w.op==='insert').every(w=>!w.input[0].is_published));
  for(const fault of ['assignment_student_versions:upsert','assignment_students:insert','assignments:update']) {
    db=pagesDatabase(pagesSeed(),{[fault]:fault==='assignments:update'?1:2});a=app(db);
    await assert.rejects(()=>a._pagesCreateSeries(plan));
    assert.equal(db.tables.assignments.length,1,'failed series rolls back '+fault);
    assert.equal(db.tables.assignment_student_versions.length,2);
  }
  db=pagesDatabase(pagesSeed());a=app(db);
  const assignment=db.tables.assignments[0], v=db.tables.assignment_student_versions[0];
  const sub={...db.tables.assignment_submissions[0]};
  assert.equal(a._pagesRecoveryGrade(assignment,v,sub).grade,'B');
  assert.equal(a._pagesRecoveryGrade(assignment,v,{...sub,content:'27-30'}).grade,'A+');
  assert.equal(a._pagesRecoveryGrade(assignment,v,{...sub,content:'27-30',submitted_at:'2026-11-07T10:00:00Z'}).grade,'B+');
  assert.equal(a._pagesRecoveryGrade(assignment,v,{...sub,content:'27-30',submitted_at:'2026-11-07T10:00:00Z',late_pass_used_at:'2026-11-07T09:00:00Z'}).grade,'A+');
  for(const patch of [{grade_override:true},{grade:'A'},{status:'excused'},{content:'finished all'},{content:'30-27'},{submitted_at:null}]) assert.equal(a._pagesRecoveryGrade(assignment,v,{...sub,...patch}),null);
  assert.equal(a._pagesRecoveryGrade(assignment,{page_label:'Week 3'},sub),null);
  for(const [content,grade] of [['27–30','A+'],['26 to 29','B'],['27,28','C'],['27','D'],['1-4','F'],['27-30 on 10/26','A+']]) assert.equal(a._pagesRecoveryGrade(assignment,v,{...sub,content}).grade,grade);
  await a._pagesRepairAssignment('old');
  assert.equal(db.tables.assignments[0].grading_type,'pages');
  assert.equal(db.tables.assignment_submissions[0].grade,'B','login id target resolved');
  assert.equal(db.tables.assignment_submissions[0].points_earned,17);
  assert.equal(db.tables.assignment_submissions[1].grade,'A','existing override kept');
  const before=db.writes.length;await a._pagesRepairAssignment('old');
  assert.equal(db.writes.slice(before).filter(w=>w.table==='assignment_submissions').length,0,'repeat repair is safe');
  // A turn-in changed after the read must not receive a stale repair grade.
  db=pagesDatabase(pagesSeed());a=app(db);
  const originalFrom=db.from;
  db.from=table=>{
    const query=originalFrom(table),update=query.update;
    query.update=row=>{
      if(table==='assignment_submissions') db.tables.assignment_submissions[0].content='27-30';
      return update(row);
    };
    return query;
  };
  await a._pagesRepairAssignment('old');
  assert.equal(db.tables.assignment_submissions[0].grade,null,'concurrent resubmission kept');
  // Missing continuation ids still group siblings; unrelated cards remain separate.
  const cards=a._pagesGroupCards([{id:'b',title:'Week B',pages_continues_from:'a',due_date:'2026-11-20'},
    {id:'c',title:'Week C',pages_continues_from:'b',due_date:'2026-11-27'},{id:'x',title:'Essay'}],['B','C','X']);
  assert.equal((cards.match(/pages-series/g)||[]).length,1);assert(cards.endsWith('X'));
  db=pagesDatabase(pagesSeed());a=app(db);
  const nodes={'pages-continues-from':{value:'old'},'pages-default-count':{value:'4'},'pages-targets':{}};
  global.document={getElementById:id=>nodes[id]};
  a._pagesCtx={classId:'math',students:db.tables.user_profiles};a._pagesRenderTable=()=>{};
  await a._pagesInit();assert(a._pagesCtx.loaded);assert(nodes['pages-continues-from'].innerHTML.includes('Workbook'));
  assert.equal(a._pagesCtx.rows[0].start,31);
  db=pagesDatabase(pagesSeed(),{'assignments:select':1});a=app(db);a._pagesCtx={classId:'math',students:[]};
  await a._pagesInit();assert(!a._pagesCtx.loaded);assert(nodes['pages-continues-from'].disabled);assert(nodes['pages-targets'].innerHTML.includes('Retry'));
  a._pagesRenderTable=()=>{};await a._pagesInit();assert(a._pagesCtx.loaded,'failed read is retryable');
  // Target reads must not silently truncate at a server page boundary.
  db=pagesDatabase({assignment_student_versions:Array.from({length:1003},(_,i)=>({id:String(i),student_id:String(i),assignment_id:'old',page_end:i}))});
  assert.equal((await app(db)._pagesLoadTargets(['old'])).get('old').size,1003);
  // 2026-11-12, Jordan: a set that follows "Week 1" starts at Week 2, and any
  // assignment can be made weekly, not only Workbook Pages.
  a=app(pagesDatabase(pagesSeed()));
  for(const [args,want] of [
    [['Spelling',0,1,null],'Spelling'],                       // one, no start: as typed
    [['Spelling',1,3,null],'Spelling · Week 2'],              // a set numbers from 1
    [['Spelling',0,1,2],'Spelling · Week 2'],                 // a chosen start
    [['Spelling',2,3,5],'Spelling · Week 7'],
    [['Spelling Week 1',0,1,2],'Spelling Week 2'],            // renumbered in place
    [['Week 3 Days 1-2 Reading',1,2,null],'Week 4 Days 1-2 Reading'],
    [['Workbook · Week 4',0,3,9],'Workbook · Week 9'],
    [['Spelling week12',1,2,null],'Spelling week13'],
    [['Grade 5 vocab',0,1,null],'Grade 5 vocab'],             // other numbers are left alone
    [['Grade 5 vocab',1,2,null],'Grade 5 vocab · Week 2'],
  ]) assert.equal(a._seriesTitle(...args),want,JSON.stringify(args));
  assert.equal(a._seriesWeekOf('Practice · Week 1'),1);assert.equal(a._seriesWeekOf('Essay 2'),null);
  assert.deepEqual(a._pagesSeriesPlan({...base,title:'Workbook · Week 1'},targets,2,2).map(w=>w.assignment.title),['Workbook · Week 2','Workbook · Week 3']);
  // A regular weekly set: no page targets, chosen students, all or nothing.
  const reg={title:'Spelling Week 1',due_date:'2026-11-13T16:00:00Z',class_id:'math',is_published:true,assigned_to_all:false,grading_type:'points'};
  const regPlan=a._seriesPlan(reg,3,2).map(w=>({...w,assignees:['ivy','oren']}));
  assert.deepEqual(regPlan.map(w=>[w.assignment.title,w.assignment.due_date]),[['Spelling Week 2','2026-11-13T16:00:00.000Z'],['Spelling Week 3','2026-11-20T16:00:00.000Z'],['Spelling Week 4','2026-11-27T16:00:00.000Z']]);
  for(const n of [0,53,1.5]) assert.throws(()=>a._seriesPlan(reg,n,null));
  db=pagesDatabase(pagesSeed());a=app(db);
  const regIds=await a._pagesCreateSeries(regPlan);
  const made=db.tables.assignments.filter(x=>regIds.includes(x.id));
  assert.equal(made.length,3);assert(made.every(x=>x.is_published&&!('pages_continues_from' in x&&x.pages_continues_from)),'regular weeks are not chained as pages');
  assert.equal(db.tables.assignment_students.filter(x=>regIds.includes(x.assignment_id)).length,6);
  assert.equal(db.tables.assignment_student_versions.length,2,'no page targets written for a regular set');
  db=pagesDatabase(pagesSeed(),{'assignment_students:insert':2});a=app(db);
  await assert.rejects(()=>a._pagesCreateSeries(regPlan));
  assert.equal(db.tables.assignments.length,1,'a failed regular set rolls back');
  await assert.rejects(()=>app(pagesDatabase(pagesSeed()))._pagesCreateSeries(regPlan.map(w=>({...w,assignees:[]}))));
  console.log('Workbook Pages: planning, rollback, recovery, grouping, picker and pagination passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
