// Run: python -m http.server 8780, then node debug-tools/workbook-pages-carry-forward.cjs
// 2026-11-17, Jordan: "on a workbook page assignment allow it so you can
// adjust the page of an earlier assignment and it updates all the ones
// following it". Invented data; every external request is blocked.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {pagesDatabase,pagesSeed}=require('../tests/workbook-pages-fixtures');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PAGES_CHROME?{executablePath:process.env.PAGES_CHROME}:{}),args:['--no-sandbox']});
  try {
    const page=await browser.newPage({timezoneId:'America/Los_Angeles'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message+' @ '+(e.stack||'').split(String.fromCharCode(10)).slice(1,4).join(' | ')));
    await page.route('https://**',r=>r.abort());
    await page.addInitScript(()=>{window.Quill=class {constructor(selector){this.root=document.querySelector(selector)||document.createElement('div');this.root.innerHTML='<p><br></p>';}on(){} };});
    await page.goto(process.env.PORTAL_URL || 'http://localhost:8780/portal/index.html');
    await page.waitForFunction(()=>window.app?.auth);
    await page.evaluate(`window.makePagesDatabase=${pagesDatabase.toString()}`);
    // Weeks 1 -> 2 -> 3, each carrying on from the one before.
    const seed=pagesSeed();
    seed.assignments[0].grading_type='pages';
    const wk=(id,from,title,due)=>({id,class_id:'math',title,grading_type:'pages',max_points:20,assignment_type:'regular',
      assigned_to_all:true,is_published:true,due_date:due,pages_continues_from:from});
    seed.assignments.push(wk('w2','old','Workbook · Week 2','2026-11-13T16:00:00.000Z'),wk('w3','w2','Workbook · Week 3','2026-11-20T16:00:00.000Z'));
    seed.assignment_student_versions.push(
      {id:'v3',assignment_id:'w2',student_id:'ivy',page_start:31,page_end:34},
      {id:'v4',assignment_id:'w2',student_id:'oren',page_start:16,page_end:21,due_date:'2026-11-14T16:00:00.000Z'},
      {id:'v5',assignment_id:'w3',student_id:'ivy',page_start:35,page_end:38},
      {id:'v6',assignment_id:'w3',student_id:'oren',page_start:22,page_end:27});
    // Oren already turned in week 2 (under his sign-in id).
    seed.assignment_submissions.push({id:'s3',assignment_id:'w2',student_id:'login-oren',content:'16-21',status:'submitted',grade:null,submitted_at:'2026-11-13T15:00:00.000Z'});
    await page.evaluate(seed=>{
      const a=window.app;window.db=window.makePagesDatabase(seed);
      a.auth.supabase=window.db;a.supabaseQuery=fn=>fn();
      a.auth.initialized=true;a.auth.userProfile={id:'teacher',user_type:'teacher'};
      a.auth.currentUser={id:'teacher'};a.userInfo={profile:a.auth.userProfile};
      a.classes=[{id:'math',name:'Invented Math',teacher_id:'teacher'}];
      a.showLoading=()=>{};a.loadClassHomeworkResults=()=>{};a.viewAssignments=async()=>{};a.viewSubmissions=async()=>{};
      window.messages=[];a.showNotification=(message,type)=>window.messages.push({message,type});
    },seed);
    const pages=()=>page.evaluate(()=>Object.fromEntries(db.tables.assignment_student_versions.map(v=>[v.assignment_id+':'+v.student_id,
      v.page_label??[v.page_start,v.page_end]])));
    const open=async(id)=>{await page.evaluate(id=>app.editAssignment(id),id);await page.waitForSelector('.pages-start[data-id="ivy"]');};

    // 1. Week 1's form offers to carry the change on, ticked.
    await open('old');
    assert.equal(await page.isChecked('#pages-carry-following'),true);
    // Ivy gets two more pages; Oren starts two later.
    await page.fill('.pages-count[data-id="ivy"]','6');
    await page.fill('.pages-start[data-id="oren"]','12');
    await page.evaluate(()=>app.submitEditAssignment('old','math'));
    let p=await pages();
    assert.deepEqual(p['old:ivy'],[27,32]);
    assert.deepEqual(p['w2:ivy'],[33,36],'week 2 moves by 2, same count');
    assert.deepEqual(p['w3:ivy'],[37,40],'and week 3 after it');
    assert.deepEqual(p['old:oren'],[12,17]);
    assert.deepEqual(p['w2:oren'],[16,21],'turned in: left alone');
    assert.deepEqual(p['w3:oren'],[22,27],'and the chain stops there for him');
    // Oren's own due date on week 2 is untouched (only page columns written).
    assert.equal(await page.evaluate(()=>db.tables.assignment_student_versions.find(v=>v.id==='v4').due_date),'2026-11-14T16:00:00.000Z');
    let last=await page.evaluate(()=>messages.at(-1));
    assert(last.message.includes('Moved to match in 2 later assignments (Workbook · Week 2, Workbook · Week 3)'),last.message);
    assert(last.message.includes('already turned in: Oren Pike on Workbook · Week 2'),last.message);

    // 2. Unticked: only this week changes.
    await open('old');
    await page.fill('.pages-count[data-id="ivy"]','4');
    await page.uncheck('#pages-carry-following');
    await page.evaluate(()=>app.submitEditAssignment('old','math'));
    p=await pages();
    assert.deepEqual(p['old:ivy'],[27,30]);
    assert.deepEqual(p['w2:ivy'],[33,36]);
    assert(!(await page.evaluate(()=>messages.at(-1).message)).includes('Moved to match'));

    // 3. One student's Adjust screen on week 2 carries on to week 3.
    await page.evaluate(()=>app.editStudentVersion('w2','ivy'));
    await page.waitForSelector('#student-version-page-start');
    assert.equal(await page.isChecked('#pages-carry-following'),true);
    await page.fill('#student-version-page-start','40');
    await page.fill('#student-version-page-count','4');
    await page.evaluate(()=>app.saveStudentVersion(false));
    p=await pages();
    assert.deepEqual(p['w2:ivy'],[40,43]);
    assert.deepEqual(p['w3:ivy'],[44,47],'moved by 7');
    last=await page.evaluate(()=>messages.at(-1));
    assert.equal(last.type,'success');
    assert(last.message.includes('Moved to match in 1 later assignment (Workbook · Week 3)'),last.message);

    // 4. The last week has nothing after it, so nothing is offered.
    await open('w3');
    assert.equal(await page.locator('#pages-carry-following').count(),0);
    await page.evaluate(()=>app.closeModal('edit-assignment'));

    // 5. The later weeks cannot be read: nothing is saved at all.
    await open('old');
    await page.fill('.pages-start[data-id="ivy"]','1');
    const before=await page.evaluate(()=>db.writes.length);
    await page.evaluate(()=>{const f=db.from;db.from=t=>{const q=f(t);if(t==='assignments'){const inn=q.in;q.in=(k,v)=>k==='pages_continues_from'?{then:r=>r({data:null,error:{message:'simulated'}})}:inn(k,v);}return q;};});
    await page.evaluate(()=>app.submitEditAssignment('old','math'));
    last=await page.evaluate(()=>messages.at(-1));
    assert.equal(last.type,'error');assert(last.message.includes('nothing was saved'),last.message);
    assert.equal(await page.evaluate(()=>db.writes.length),before);

    if(process.env.SHOT){await page.evaluate(()=>app.closeModal('edit-assignment'));}
    assert.deepEqual(errors,[]);
    console.log('Workbook Pages carry-forward: 5 journeys passed.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
