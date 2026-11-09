// Run: python3 -m http.server 8780, then node debug-tools/workbook-pages-journeys.cjs
// Exercises real forms against invented data. All external requests are blocked.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {pagesDatabase,pagesSeed}=require('../tests/workbook-pages-fixtures');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PAGES_CHROME?{executablePath:process.env.PAGES_CHROME}:{}),args:['--no-sandbox']});
  try {
    const page=await browser.newPage({timezoneId:'America/Los_Angeles'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://**',r=>r.abort());
    // Quill itself is not under test; its CDN is deliberately unavailable.
    await page.addInitScript(()=>{window.Quill=class {constructor(selector){this.root=document.querySelector(selector);this.root.innerHTML='<p><br></p>';}on(){} };});
    await page.goto(process.env.PORTAL_URL || 'http://localhost:8780/portal/index.html');
    await page.waitForFunction(()=>window.app?.auth);
    await page.evaluate(`window.makePagesDatabase=${pagesDatabase.toString()}`);
    await page.evaluate(seed=>{
      const a=window.app;window.db=window.makePagesDatabase(seed);
      a.auth.supabase=window.db;a.supabaseQuery=fn=>fn();
      a.auth.initialized=true;a.auth.userProfile={id:'teacher',user_type:'teacher'};
      a.auth.currentUser={id:'teacher'};a.auth.studentRecordId=()=>a.userInfo.profile.id;
      a.userInfo={profile:a.auth.userProfile};a.classes=[{id:'math',name:'Invented Math',teacher_id:'teacher'}];
      a.showLoading=()=>{};a.loadClassHomeworkResults=()=>{};
      a.sendNewAssignmentNotifications=async()=>{};
      window.messages=[];a.showNotification=(message,type)=>window.messages.push({message,type});
    },pagesSeed());
    // The damaged assignment is visible, repairable and offered as a predecessor.
    await page.evaluate(()=>app.viewAssignments('math'));
    await page.getByRole('button',{name:'Restore & grade pending pages'}).click();
    await page.waitForFunction(()=>!app._pagesRepairing);
    assert.equal(await page.evaluate(()=>db.tables.assignments[0].grading_type),'pages');
    assert.equal(await page.evaluate(()=>db.tables.assignment_submissions[0].grade),'B');
    assert.equal(await page.evaluate(()=>db.tables.assignment_submissions[1].grade),'A');
    // Edit the repaired assignment, change its title, save and reload.
    await page.evaluate(()=>app.editAssignment('old'));
    await page.waitForTimeout(150);
    assert.equal(await page.locator('input[name="edit-grading-type"]:checked').inputValue(),'pages');
    await page.fill('#edit-assignment-title','Edited workbook');
    await page.evaluate(()=>app.submitEditAssignment('old','math'));
    assert.equal(await page.evaluate(()=>db.tables.assignments[0].grading_type),'pages');
    assert.equal(await page.evaluate(()=>db.tables.assignment_student_versions[0].page_end),30);
    await page.waitForTimeout(200);
    // Plan three weeks from the previous targets, with distinct student counts.
    await page.evaluate(()=>app.createAssignment('math'));
    await page.selectOption('#assignment-type','pages');
    await page.waitForFunction(()=>app._pagesCtx.loaded);
    assert.equal(await page.inputValue('#pages-continues-from'),'old');
    assert.equal(await page.inputValue('.pages-start[data-id="ivy"]'),'31');
    assert.equal(await page.inputValue('.pages-count[data-id="oren"]'),'6');
    await page.fill('#assignment-title','Winter practice');
    await page.fill('#assignment-due-date','2026-11-13T16:00');
    await page.fill('#pages-weeks','3');
    assert((await page.locator('#pages-series-preview').innerText()).includes('Week 3'));
    await page.evaluate(()=>app.submitCreateAssignment('math'));
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>db.tables.assignments.length),4);
    assert.equal(await page.locator('.pages-series').count(),1);
    assert((await page.locator('.pages-series summary').first().innerText()).includes('4 linked assignments'));
    assert.deepEqual(await page.evaluate(()=>db.tables.assignment_student_versions.filter(v=>v.student_id==='oren').map(v=>[v.page_start,v.page_end])),[[10,15],[16,21],[22,27],[28,33]]);
    await page.screenshot({path:'/tmp/workbook-pages-teacher.png',fullPage:true});
    // Student and parent listing use the same grouping without recovery controls.
    for(const role of ['student','parent']) {
      await page.evaluate(role=>{
        app.userInfo.profile={id:'ivy',user_type:role};
        app.children=[{id:'ivy',first_name:'Ivy',classes:[{id:'math'}]}];
      },role);
      await page.evaluate(()=>app.viewAssignments('math'));
      assert.equal(await page.locator('.pages-series').count(),1,role+' series');
      assert.equal(await page.getByRole('button',{name:'Restore & grade pending pages'}).count(),0);
    }
    assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>messages.filter(m=>m.type==='error').length),0);
    console.log('Browser journeys passed: repair, edit/save/reload, continuation, 3-week creation, per-student targets, teacher/student/parent grouping.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
