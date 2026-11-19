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
    A('Rubric poster',{grading_type:'rubric'}),          // Ivy graded with points and no letter
    A('Next week reading',{due_date:new Date(Date.now()+3*864e5).toISOString()}), // due this week
    A('Old class quiz',{class_id:'oldmath'}),            // a class Ivy has left
    A('Last year essay',{due_date:'2025-10-01T16:00:00.000Z'}), // last school year
  ],
  assignment_submissions:[S('Online essay','ivy','submitted'),S('Online essay','oren','under_review'),
    S('Paper test','ivy','graded'),S('Paper project','oren','excused'),
    S('Rubric poster','ivy','graded',{grade:null,points_earned:9})],
  assignment_student_versions:[],assignment_students:[],grade_categories:[],
  classes:[{id:'math',name:'Invented Math',subject:'Math',teacher_id:'t'}],
  class_enrollments:[{id:'e1',class_id:'math',student_id:'ivy',status:'active'},{id:'e2',class_id:'math',student_id:'oren',status:'active'}],
  parent_child_links:[{parent_id:'mom',child_id:'ivy',status:'active'},{parent_id:'mom',child_id:'oren',status:'active'},
    {parent_id:'gone',child_id:'ivy',status:'inactive'}],
  user_profiles:[{id:'ivy',first_name:'Ivy',last_name:'Marsh',user_type:'student'},{id:'oren',first_name:'Oren',last_name:'Pike',user_type:'student'},
    {id:'mom',first_name:'Wren',last_name:'Marsh',user_type:'parent'},{id:'gone',first_name:'Old',last_name:'Link',user_type:'parent'},
    {id:'t',first_name:'Tess',last_name:'Hale',user_type:'teacher'}],
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
    // 4. Ivy's page: this quarter's work in the classes she is in now, sorted.
    await page.evaluate(()=>{for(const id of ['view-quarter-assignments','view-assignments'])app.closeModal(id);
      const a=app;a.loadStudentOverview=async()=>null;a.calculateStudentGPA=async()=>null;
      a.getStudentStrikes=async()=>({strikes:[],count:0,nextDecayDate:null});a.renderChildOverviewSection=()=>'';
      a.children[0].classes=[{id:'math',name:'Invented Math'},{id:'oldmath',name:'Old Math'}];a.children[0].activeClassIds=['math'];});
    await page.evaluate(()=>app.showChildDetails('ivy'));
    await page.waitForSelector('text=Turned in, waiting for a grade');
    const d=await page.innerText('body');
    assert(!d.includes('Last year essay'),'last year is not listed');
    assert(!d.includes('Old class quiz')&&!d.includes('Old Math'),'a class she has left is not listed');
    assert(!d.includes('Paper quiz'),'offline, not graded: hidden');
    for (const h of ['Late (1)','Due (1)','Turned in, waiting for a grade (1)','Graded (2)','Classes (1)']) assert(d.includes(h),h);
    assert(d.includes('A- (9/10)'),'a grade with points and no letter gets its letter');
    assert(d.includes('B (8/10)'));
    const order=['Online worksheet','Next week reading','Online essay'].map(t=>d.indexOf(t));
    assert(order.every((x,i)=>x>0&&(i===0||x>order[i-1])),'late, then due, then waiting');
    if (process.env.SHOT) await page.screenshot({path:process.env.SHOT.replace('.png','-child.png'),fullPage:true});
    // 5. The home page line under each child.
    await page.evaluate(()=>{const el=document.createElement('div');el.id='child-work-ivy';document.body.prepend(el);return app.loadChildrenWorkSummaries();});
    assert.equal(await page.innerText('#child-work-ivy'),'1 late · 1 due this week · 1 waiting for a grade');
    // The class list shows the letter too.
    await page.evaluate(()=>{document.querySelectorAll('.modal').forEach(m=>m.remove());return app.viewAssignments('math');});
    await page.waitForSelector('text=Rubric poster');
    assert.deepEqual(await statusOf('Rubric poster'),['Ivy','Graded: A- (9/10)','Oren','Missing']);

    // 6. A teacher can start a message to a student's parent.
    await page.evaluate(()=>{app.userInfo={profile:{id:'t',user_type:'teacher'},user:{id:'t'}};app.classes=[{id:'math',teacher_id:'t'}];
      app.updateMessageRecipientsDropdown=()=>{};return app.loadMessageRecipients();});
    const rec=await page.evaluate(()=>app.messageRecipients.map(r=>r.type+': '+r.name));
    assert(rec.includes("Parent: Wren Marsh (Ivy & Oren's parent)"),JSON.stringify(rec));
    assert(!rec.some(r=>r.includes('Old Link')),'an inactive link is not offered');
    assert(rec.includes('Student: Ivy Marsh'));

    console.log('Parent assignment status: 6 journeys passed (class list, children\'s grades, quarter, child page, home line, teacher messaging a parent).');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
