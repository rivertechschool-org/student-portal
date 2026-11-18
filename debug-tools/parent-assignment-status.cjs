// Run: python -m http.server 8780, then node debug-tools/parent-assignment-status.cjs
// A parent of two invented children opens a class's assignments, the
// children's grades and a quarter's assignments. Work turned in shows as
// turned in, not graded yet; work graded offline does not appear until it is
// graded or excused (2026-11-18). All external requests are blocked.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {pagesDatabase}=require('../tests/workbook-pages-fixtures');
const A=(id,extra)=>({id,class_id:'math',title:id,grading_type:'points',max_points:10,assignment_type:'regular',assigned_to_all:true,
  is_published:true,graded_offline:false,due_date:'2026-11-10T16:00:00.000Z',created_at:'2026-11-01T00:00:00.000Z',...extra});
const S=(assignment_id,student_id,status,extra)=>({id:assignment_id+student_id,assignment_id,student_id,status,
  submitted_at:status==='submitted'||status==='under_review'?'2026-11-09T15:00:00.000Z':null,grade:status==='graded'?'B':null,points_earned:status==='graded'?8:null,...extra});
const seed={
  assignments:[
    A('Online essay'),                                   // Ivy turned in, Oren under review
    A('Paper quiz',{graded_offline:true}),               // offline, nobody graded: hidden
    A('Paper test',{graded_offline:true}),               // offline, Ivy graded: Ivy only
    A('Online worksheet'),                               // nobody turned in: missing
    A('Paper project',{graded_offline:true}),            // offline, Oren excused: Oren only
    A('Reading list',{assignment_type:'info',graded_offline:true,due_date:null}),
  ],
  assignment_submissions:[S('Online essay','ivy','submitted'),S('Online essay','oren','under_review'),
    S('Paper test','ivy','graded'),S('Paper project','oren','excused')],
  assignment_student_versions:[],assignment_students:[],grade_categories:[],
  classes:[{id:'math',name:'Invented Math',subject:'Math',teacher_id:'t'}],
  class_enrollments:[{id:'e1',class_id:'math',student_id:'ivy',status:'active'},{id:'e2',class_id:'math',student_id:'oren',status:'active'}],
  parent_child_links:[{parent_id:'mom',child_id:'ivy'},{parent_id:'mom',child_id:'oren'}],
  quarters:[{id:'q',name:'Fall',school_year:'2026-27',is_current:true,is_archived:false,start_date:'2026-09-01',end_date:'2026-12-20'}],
};
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PAGES_CHROME?{executablePath:process.env.PAGES_CHROME}:{}),args:['--no-sandbox']});
  try {
    const page=await browser.newPage({timezoneId:'America/Los_Angeles',viewport:{width:390,height:844}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://**',r=>r.abort());
    await page.goto(process.env.PORTAL_URL || 'http://localhost:8780/portal/index.html');
    await page.waitForFunction(()=>window.app?.auth);
    await page.evaluate(`window.makePagesDatabase=${pagesDatabase.toString()}`);
    await page.evaluate(seed=>{
      const a=window.app;window.db=window.makePagesDatabase(seed);
      a.auth.supabase=window.db;a.supabaseQuery=fn=>fn();
      a.auth.initialized=true;a.auth.userProfile={id:'mom',user_type:'parent'};a.auth.currentUser={id:'mom'};
      a.userInfo={profile:a.auth.userProfile,user:a.auth.currentUser};
      a.classes=[{id:'math',name:'Invented Math'}];
      a.children=[{id:'ivy',first_name:'Ivy',last_name:'Marsh',classes:[{id:'math'}]},{id:'oren',first_name:'Oren',last_name:'Pike',classes:[{id:'math'}]}];
      a.showLoading=()=>{};
      window.messages=[];a.showNotification=(message,type)=>window.messages.push({message,type});
    },seed);
    const cards=()=>page.$$eval('.card h4',x=>x.map(e=>e.textContent.trim()));
    const statusOf=(title)=>page.$$eval('.card',(cs,title)=>{const c=cs.find(c=>c.querySelector('h4')?.textContent.trim()===title);
      return c?[...c.querySelectorAll('div[style*="space-between"] > span')].map(s=>s.innerText.trim()).filter(Boolean):null;},title);

    // 1. The class's assignments.
    await page.evaluate(()=>app.viewAssignments('math'));
    await page.waitForSelector('text=Online essay');
    const shown=await cards();
    assert(!shown.includes('Paper quiz'),'offline work not graded yet is hidden');
    for (const t of ['Online essay','Paper test','Online worksheet','Paper project','Reading list']) assert(shown.includes(t),t+' shown');
    assert.deepEqual(await statusOf('Online essay'),['Ivy','Turned in, not graded yet','Oren','Turned in, not graded yet']);
    assert.deepEqual(await statusOf('Paper test'),['Ivy','Graded: B (8/10)'],'only the graded child');
    assert.deepEqual(await statusOf('Paper project'),['Oren','Excused']);
    assert.deepEqual(await statusOf('Online worksheet'),['Ivy','Missing','Oren','Missing']);
    assert(!(await page.innerText('body')).includes('Offline Assignment'));
    if (process.env.SHOT) await page.screenshot({path:process.env.SHOT,fullPage:true});
    // Nothing to show at all: the empty message, not an empty list.
    await page.evaluate(()=>{db.tables.assignments=db.tables.assignments.filter(a=>a.id==='Paper quiz');app.closeModal('view-assignments');app.viewAssignments('math');});
    await page.waitForSelector('text=There are no assignments for Fall.');
    await page.evaluate(s=>{db.tables.assignments=s;},seed.assignments);

    // 2. The children's grades table.
    await page.evaluate(()=>app.viewChildrenGrades('math'));
    await page.waitForSelector('#children-grades-quarter-select');
    const rows=await page.$$eval('tbody tr',x=>x.map(r=>[...r.cells].map(c=>c.innerText.trim())).map(c=>[c[0],c[2]]));
    assert.deepEqual(rows.filter(r=>r[0]==='Paper quiz'),[],'hidden in the grades table too');
    assert.deepEqual(rows.filter(r=>r[0]==='Online essay'),[['Online essay','Turned in, not graded yet'],['Online essay','Turned in, not graded yet']]);
    assert.deepEqual(rows.filter(r=>r[0]==='Paper test'),[['Paper test','Graded']],'Ivy graded; Oren\'s row hidden');
    assert.deepEqual(rows.filter(r=>r[0]==='Paper project'),[['Paper project','Excused']]);
    await page.evaluate(()=>app.closeModal('children-grades'));

    // 3. A quarter's assignments, for one child.
    await page.evaluate(()=>{app.closeModal('view-assignments');app.viewQuarterAssignments('q',null,'oren');});
    await page.waitForSelector('text=Fall - Assignments');
    const q=await page.innerText('body');
    assert(!q.includes('Paper quiz')&&!q.includes('Paper test'),'Oren: offline work not graded is hidden');
    assert(q.includes('Paper project')&&q.includes('EXCUSED'));
    assert(q.includes('TURNED IN, NOT GRADED YET'));
    assert(q.includes('MISSING'));

    assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)),'no sideways scroll on a phone');
    assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>messages.filter(m=>m.type==='error').length),0,JSON.stringify(await page.evaluate(()=>messages)));
    console.log('Parent assignment status: 3 journeys passed (class list, children\'s grades, quarter).');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
