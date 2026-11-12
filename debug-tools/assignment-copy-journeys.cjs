// Run: python -m http.server 8780, then node debug-tools/assignment-copy-journeys.cjs
// 2026-11-12, Jordan: "allows me to create a duplicate version of assignments
// and can set it to whatever starting point ... the past one could have been
// week 1 ... create a new set starting at 2 instead of 1."
// Create Assignment > Copy an Assignment, and the shared "How many weeks" /
// "Start numbering at week" boxes, for regular and Workbook Pages work.
// Invented data; every external request is blocked.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {pagesDatabase,pagesSeed}=require('../tests/workbook-pages-fixtures');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PAGES_CHROME?{executablePath:process.env.PAGES_CHROME}:{}),args:['--no-sandbox']});
  try {
    const page=await browser.newPage({timezoneId:'America/Los_Angeles'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://**',r=>r.abort());
    await page.addInitScript(()=>{window.Quill=class {constructor(selector){this.root=document.querySelector(selector);this.root.innerHTML='<p><br></p>';}on(){} };});
    await page.goto(process.env.PORTAL_URL || 'http://localhost:8780/portal/index.html');
    await page.waitForFunction(()=>window.app?.auth);
    await page.evaluate(`window.makePagesDatabase=${pagesDatabase.toString()}`);
    const seed=pagesSeed();
    // The workbook last week, as Week 1 of a Pages set.
    Object.assign(seed.assignments[0],{title:'Workbook · Week 1',grading_type:'pages'});
    // A regular weekly assignment for one student only.
    seed.assignments.push({id:'spell1',class_id:'math',title:'Spelling Week 1',description:'<p>List A</p>',grading_type:'points',max_points:10,
      assignment_type:'regular',assigned_to_all:false,is_published:true,due_date:'2026-11-13T16:00:00.000Z',late_pass_allowed:false});
    seed.assignment_students.push({id:'as1',assignment_id:'spell1',student_id:'ivy'});
    await page.evaluate(seed=>{
      const a=window.app;window.db=window.makePagesDatabase(seed);
      a.auth.supabase=window.db;a.supabaseQuery=fn=>fn();
      a.auth.initialized=true;a.auth.userProfile={id:'teacher',user_type:'teacher'};
      a.auth.currentUser={id:'teacher'};a.auth.studentRecordId=()=>a.userInfo.profile.id;
      a.userInfo={profile:a.auth.userProfile};a.classes=[{id:'math',name:'Invented Math',teacher_id:'teacher'}];
      a.showLoading=()=>{};a.loadClassHomeworkResults=()=>{};a.viewAssignments=async()=>{};
      window.notified=[];a.sendNewAssignmentNotifications=async(id,title)=>window.notified.push(title);
      window.messages=[];a.showNotification=(message,type)=>window.messages.push({message,type});
    },seed);
    const open=async()=>{await page.evaluate(()=>app.createAssignment('math'));await page.waitForSelector('#series-section');await page.waitForTimeout(150);};
    const copy=async title=>{
      await page.getByRole('button',{name:'📄 Copy an Assignment'}).click();
      await page.locator('#assignment-template-list .card',{hasText:title}).click();
      await page.waitForFunction(()=>/Copied from/.test(document.getElementById('assignment-template-banner').textContent));
    };
    const made=()=>page.evaluate(()=>db.tables.assignments.filter(a=>a.id.startsWith('new-')).map(a=>({id:a.id,title:a.title,due:a.due_date,from:a.pages_continues_from??null,pub:a.is_published,all:a.assigned_to_all,type:a.grading_type})));

    // 1. A regular assignment, copied: Week 1 -> Week 2, a week later, same student.
    await open();
    assert(await page.isVisible('#series-section'),'weekly boxes show for a regular assignment');
    await copy('Spelling Week 1');
    assert.equal(await page.inputValue('#assignment-title'),'Spelling Week 2');
    assert.equal(await page.inputValue('#series-start'),'2');
    assert.equal(await page.inputValue('#assignment-due-date'),'2026-11-20T08:00');
    assert.equal(await page.isChecked('#assign-to-specific'),true);
    assert.equal(await page.isChecked('.student-checkbox[value="ivy"]'),true);
    assert.equal(await page.isChecked('.student-checkbox[value="oren"]'),false);
    assert.equal(await page.isChecked('#assignment-late-pass-allowed'),false,'settings come with the copy');
    const banner=await page.innerText('#assignment-template-banner');
    assert(banner.includes('numbered from Week 2') && banner.includes('same 1 student'),banner);
    // Three weeks of it.
    await page.fill('#pages-weeks','3');
    const preview=await page.innerText('#series-preview');
    assert(preview.includes('Spelling Week 2') && preview.includes('Spelling Week 4') && !preview.includes('Week 5'),preview);
    await page.evaluate(()=>app.submitCreateAssignment('math'));
    await page.waitForTimeout(200);
    let m=await made();
    assert.deepEqual(m.map(x=>[x.title,x.due]),[['Spelling Week 2','2026-11-20T16:00:00.000Z'],['Spelling Week 3','2026-11-27T16:00:00.000Z'],['Spelling Week 4','2026-12-04T16:00:00.000Z']]);
    assert(m.every(x=>x.pub && x.all===false && x.from===null && x.type==='points'),JSON.stringify(m));
    assert.deepEqual(await page.evaluate(ids=>db.tables.assignment_students.filter(r=>ids.includes(r.assignment_id)).map(r=>r.student_id),m.map(x=>x.id)),['ivy','ivy','ivy']);
    assert.deepEqual(await page.evaluate(()=>notified),['Spelling Week 2','Spelling Week 3','Spelling Week 4']);
    assert(await page.evaluate(()=>db.tables.assignments.find(a=>a.title==='Spelling Week 3').description==='<p>List A</p>'));

    // 2. Workbook Pages, copied: carries on from it, Week 2 onwards.
    await open();
    await copy('Workbook · Week 1');
    assert.equal(await page.inputValue('#assignment-type'),'pages');
    assert.equal(await page.inputValue('#pages-continues-from'),'old');
    assert.equal(await page.inputValue('.pages-start[data-id="ivy"]'),'31');
    assert.equal(await page.inputValue('#assignment-title'),'Workbook · Week 2');
    await page.fill('#pages-weeks','2');
    assert((await page.innerText('#pages-series-preview')).includes('Workbook · Week 3'));
    const before=(await made()).length;
    await page.evaluate(()=>app.submitCreateAssignment('math'));
    await page.waitForTimeout(200);
    m=(await made()).slice(before);
    assert.deepEqual(m.map(x=>[x.title,x.from]),[['Workbook · Week 2','old'],['Workbook · Week 3',m[0].id]]);
    assert.deepEqual(await page.evaluate(ids=>db.tables.assignment_student_versions.filter(v=>ids.includes(v.assignment_id)&&v.student_id==='ivy').map(v=>[v.page_start,v.page_end]),m.map(x=>x.id)),[[31,34],[35,38]]);

    // 3. Typed by hand: the start box alone numbers one assignment; blank keeps it as typed.
    await open();
    await page.fill('#assignment-title','Essay');
    await page.fill('#assignment-due-date','2026-11-16T15:00');
    await page.fill('#series-start','4');
    assert((await page.innerText('#series-preview')).includes('Essay · Week 4'));
    await page.evaluate(()=>app.submitCreateAssignment('math'));
    await page.waitForTimeout(200);
    assert.equal((await made()).at(-1).title,'Essay · Week 4');
    await open();
    await page.fill('#assignment-title','Lab report');
    await page.fill('#assignment-due-date','2026-11-16T15:00');
    await page.evaluate(()=>app.submitCreateAssignment('math'));
    await page.waitForTimeout(200);
    assert.equal((await made()).at(-1).title,'Lab report');

    // 4. A set that runs past the quarter is refused whole.
    await open();
    await page.fill('#assignment-title','Reading log');
    await page.fill('#assignment-due-date','2026-11-16T15:00');
    await page.fill('#pages-weeks','10');
    const count=(await made()).length;
    await page.evaluate(()=>app.submitCreateAssignment('math'));
    await page.waitForTimeout(200);
    assert.equal((await made()).length,count);
    assert((await page.evaluate(()=>messages.at(-1).message)).includes('within the selected quarter'));

    // 5. Information items have no due date, so no weekly boxes.
    await page.selectOption('#assignment-type','info');
    assert.equal(await page.isVisible('#series-section'),false);
    await page.selectOption('#assignment-type','regular');
    assert.equal(await page.isVisible('#series-section'),true);

    if (process.env.SHOT) {
      await open();await copy('Spelling Week 1');await page.fill('#pages-weeks','3');
      await page.locator('#create-assignment-form').screenshot({path:process.env.SHOT});
    }
    assert.deepEqual(errors,[]);
    console.log('Copy an Assignment / weekly numbering: 5 journeys passed.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
