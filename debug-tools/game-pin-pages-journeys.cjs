// Read-only teacher journeys with invented students; no live school requests.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {pagesDatabase,pagesSeed}=require('../tests/workbook-pages-fixtures');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PAGES_CHROME || '/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const page=await browser.newPage();
  await page.route('https://**',r=>r.abort());
  await page.goto(process.env.PORTAL_URL || 'http://localhost:8780/portal/index.html');
  await page.waitForFunction(()=>window.app?.auth);
  await page.evaluate(`window.makePagesDatabase=${pagesDatabase.toString()}`);
  const seed=pagesSeed();seed.assignments[0].grading_type='pages';seed.user_profiles[0].games_pin='TEST';
  await page.evaluate(seed=>{
   window.db=makePagesDatabase(seed);app.auth.supabase=db;app.supabaseQuery=fn=>fn();
   app.userInfo={profile:{user_type:'teacher'}};app.auth.userProfile=app.userInfo.profile;
   app.showLoading=()=>{};window.messages=[];
   app._showRivenMessage=msg=>messages.push(msg);app.terminalPrintError=msg=>messages.push(msg);
  },seed);
  // The actual modal joins a login-id submission to its profile-id target.
  await page.evaluate(()=>app.viewSubmissions('old'));
  let rows=page.locator('.submission-item');
  assert.equal(await rows.count(),2);
  const ivy=rows.filter({hasText:'Ivy Marsh'});
  assert.match(await ivy.innerText(),/Assigned pages \/ work: Pages 27–30/);
  assert.match(await ivy.innerText(),/Student reported: Pgs 26-29/);
  // Teacher can compare labels and missing turn-ins, with user text escaped.
  await page.evaluate(()=>{
   app.closeModal('view-submissions');
   Object.assign(db.tables.assignment_student_versions[0],{page_start:null,page_end:null,page_label:'Week 3 <review>'});
   db.tables.assignment_submissions[0].content='Week 3 <img src=x onerror=alert(1)>';
   db.tables.assignment_submissions=db.tables.assignment_submissions.slice(0,1);
   return app.viewSubmissions('old');
  });
  assert.match(await ivy.innerText(),/Week 3 <review>/);
  assert.match(await ivy.innerText(),/Week 3 <img/);
  assert.equal(await ivy.locator('.pages-submission-summary img').count(),0);
  assert.match(await rows.filter({hasText:'Oren Pike'}).innerText(),/Student reported: Not submitted/);
  // No targets, an empty response, and ordinary assignments stay distinct.
  assert.deepEqual(await page.evaluate(()=>{
   const a={grading_type:'pages'};
   return [app._pagesSubmissionSummary(a,{submitted_at:'2026-11-01',content:''}).includes('No pages reported'),
    app._pagesSubmissionSummary(a,null).includes('Not set'),app._pagesSubmissionSummary({grading_type:'points'},null)];
  }),[true,true,'']);
  // PIN lookup reads fresh data and never calls a write or regeneration RPC.
  const lookup=()=>page.evaluate(()=>app.terminalViewGamePin({student:{id:'ivy',full_name:'Ivy Marsh'}}));
  await lookup();assert.match(await page.evaluate(()=>messages.at(-1)),/TEST/);
  await page.evaluate(()=>{db.tables.user_profiles[0].games_pin='NEXT';});
  await lookup();assert.match(await page.evaluate(()=>messages.at(-1)),/NEXT/);
  await page.evaluate(()=>{db.tables.user_profiles[0].games_pin=null;});
  await lookup();assert.match(await page.evaluate(()=>messages.at(-1)),/No games PIN is set/);
  await page.evaluate(()=>app.terminalViewGamePin({}));assert.match(await page.evaluate(()=>messages.at(-1)),/Which student/);
  await page.evaluate(()=>{app.userInfo.profile.user_type='student';});
  await lookup();assert.match(await page.evaluate(()=>messages.at(-1)),/Only staff/);
  await page.evaluate(()=>{
   app.userInfo.profile.user_type='teacher';app.supabaseQuery=async()=>({data:null,error:{message:'denied'}});
  });
  await lookup();assert.match(await page.evaluate(()=>messages.at(-1)),/could not read/);
  assert.equal(await page.evaluate(()=>db.writes.length),0);
  console.log('Teacher pages comparison and game PIN journeys: 19 checks passed; no live backend accessed.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
