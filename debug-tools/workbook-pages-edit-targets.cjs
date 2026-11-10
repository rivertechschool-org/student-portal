// Run: python -m http.server 8780, then node debug-tools/workbook-pages-edit-targets.cjs
// 2026-11-09, Jordan: "I can't edit a student's pages after the assignment has
// been posted for the workbook assignments. I entered in some pages
// incorrectly." Edit Assignment now shows each student's pages. Invented data;
// every external request is blocked.
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
    seed.assignments[0].grading_type='pages';
    // Oren has his own due date on the same row as his pages; it must survive.
    seed.assignment_student_versions[1].due_date='2026-11-08T16:00:00.000Z';
    // Ivy was already graded on the wrong pages.
    Object.assign(seed.assignment_submissions[0],{status:'graded',grade:'C'});
    await page.evaluate(seed=>{
      const a=window.app;window.db=window.makePagesDatabase(seed);
      a.auth.supabase=window.db;a.supabaseQuery=fn=>fn();
      a.auth.initialized=true;a.auth.userProfile={id:'teacher',user_type:'teacher'};
      a.auth.currentUser={id:'teacher'};a.userInfo={profile:a.auth.userProfile};
      a.classes=[{id:'math',name:'Invented Math',teacher_id:'teacher'}];
      a.showLoading=()=>{};a.loadClassHomeworkResults=()=>{};a.viewAssignments=async()=>{};
      window.messages=[];a.showNotification=(message,type)=>window.messages.push({message,type});
    },seed);
    const versions=()=>page.evaluate(()=>Object.fromEntries(db.tables.assignment_student_versions.map(v=>[v.student_id,[v.page_start,v.page_end,v.page_label??null,v.due_date??null]])));
    const open=async()=>{await page.evaluate(()=>app.editAssignment('old'));await page.waitForSelector('.pages-start[data-id="ivy"]');};

    // 1. The form shows what each student has now.
    await open();
    assert.equal(await page.inputValue('.pages-start[data-id="ivy"]'),'27');
    assert.equal(await page.inputValue('.pages-count[data-id="ivy"]'),'4');
    assert.equal(await page.inputValue('.pages-start[data-id="oren"]'),'10');
    assert.equal(await page.inputValue('.pages-count[data-id="oren"]'),'6');

    // 2. Fix Ivy's pages. Only Ivy is written, only the page columns.
    await page.fill('.pages-start[data-id="ivy"]','31');
    await page.fill('.pages-count[data-id="ivy"]','2');
    assert.equal(await page.locator('.pages-end[data-id="ivy"]').innerText(),'pp. 31–32');
    await page.evaluate(()=>app.submitEditAssignment('old','math'));
    let v=await versions();
    assert.deepEqual(v.ivy,[31,32,null,null]);
    assert.deepEqual(v.oren,[10,15,null,'2026-11-08T16:00:00.000Z']);
    const up=await page.evaluate(()=>db.writes.filter(w=>w.table==='assignment_student_versions'));
    assert.equal(up.length,1);
    assert.deepEqual(Object.keys(up[0].input[0]).sort(),['assignment_id','page_end','page_label','page_start','student_id']);
    let last=await page.evaluate(()=>messages.at(-1));
    assert.equal(last.type,'warning');
    assert(last.message.includes('Pages changed for 1 student') && last.message.includes('Ivy Marsh'),last.message);
    assert.equal(await page.evaluate(()=>db.tables.assignments[0].grading_type),'pages');

    // 3. Words instead of numbers, and Oren's own due date still kept.
    await open();
    assert.equal(await page.inputValue('.pages-start[data-id="ivy"]'),'31');
    await page.fill('.pages-start[data-id="ivy"]','Week 4 Days 1-2');
    await page.fill('.pages-start[data-id="oren"]','12');
    await page.evaluate(()=>app.submitEditAssignment('old','math'));
    v=await versions();
    assert.deepEqual(v.ivy,[null,null,'Week 4 Days 1-2',null]);
    assert.deepEqual(v.oren,[12,17,null,'2026-11-08T16:00:00.000Z']);

    // 4. Clearing a student's pages is refused, and nothing at all is saved.
    await open();
    assert.equal(await page.inputValue('.pages-start[data-id="ivy"]'),'Week 4 Days 1-2');
    const before=await page.evaluate(()=>db.writes.length);
    await page.fill('#edit-assignment-title','Should not save');
    await page.fill('.pages-start[data-id="oren"]','');
    await page.fill('.pages-count[data-id="oren"]','');
    await page.evaluate(()=>app.submitEditAssignment('old','math'));
    last=await page.evaluate(()=>messages.at(-1));
    assert.equal(last.type,'error');assert(last.message.includes('Oren Pike'),last.message);
    assert.equal(await page.evaluate(()=>db.writes.length),before);
    assert.notEqual(await page.evaluate(()=>db.tables.assignments[0].title),'Should not save');
    await page.evaluate(()=>app.closeModal('edit-assignment'));

    // 5. Saving with no page changes writes no pages and says the usual thing.
    await open();
    await page.evaluate(()=>app.submitEditAssignment('old','math'));
    assert.equal(await page.evaluate(()=>db.writes.filter(w=>w.table==='assignment_student_versions').length),2);
    assert.equal(await page.evaluate(()=>messages.at(-1).message),'Assignment updated successfully!');

    // 6. A failed read says so instead of showing empty boxes, and saving
    //    leaves the pages alone.
    await page.evaluate(()=>{const f=db.from;db.from=t=>{const q=f(t);if(t==='assignment_student_versions'){q.range=()=>({then:(r)=>r({data:null,error:{message:'simulated'}})});}return q;};});
    await page.evaluate(()=>app.editAssignment('old'));
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.pages-start').count(),0);
    assert((await page.locator('body').innerText()).includes('could not be loaded'));
    await page.evaluate(()=>app.submitEditAssignment('old','math'));
    assert.deepEqual((await versions()).ivy,[null,null,'Week 4 Days 1-2',null]);

    assert.deepEqual(errors,[]);
    console.log('Edit Assignment pages: 6 journeys passed.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
