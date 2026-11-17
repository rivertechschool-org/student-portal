// Run: python -m http.server 8780, then node debug-tools/low-grades-journeys.cjs
// 2026-11-17, Jordan: "an admin tool that checks a quarter over all students
// or filtered student(s) and flags all classes that were a D or less."
// Invented data; every external request is blocked.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pagesDatabase}=require('../tests/workbook-pages-fixtures');
const BASE=process.env.BASE_URL||'http://localhost:8780';
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PAGES_CHROME?{executablePath:process.env.PAGES_CHROME}:{}),args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:900},acceptDownloads:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://**',r=>r.abort());
    await page.goto(BASE+'/portal/index.html');
    await page.waitForFunction(()=>window.app?.auth);
    await page.evaluate(`window.makeDb=${pagesDatabase.toString()}`);
    const today=new Date(), iso=d=>d.toISOString();
    const q1s=new Date(today-100*864e5), q2s=new Date(today-20*864e5), q3s=new Date(+today+40*864e5);
    await page.evaluate(([q1s,q2s,q3s])=>{
      const cls=(id,name,extra={})=>({id,name,subject:'Math',teacher_id:'t1',status:'active',on_report_card:true,...extra});
      const a=window.app;
      window.db=window.makeDb({
        quarters:[{id:'q1',name:'Q1',school_year:'2026-2027',start_date:q1s,is_current:false},
          {id:'q2',name:'Q2',school_year:'2026-2027',start_date:q2s,is_current:true},
          {id:'q3',name:'Q3',school_year:'2026-2027',start_date:q3s,is_current:false}],
        user_profiles:[
          {id:'ava',first_name:'Ava',last_name:'Brook',grade_level:'7',user_type:'student'},
          {id:'ben',first_name:'Ben',last_name:'Alder',grade_level:'10',user_type:'student'},
          {id:'cy',first_name:'Cy',last_name:'Cole',grade_level:'11',user_type:'student'},
          {id:'t1',first_name:'Jo',last_name:'Fennick',user_type:'teacher'}],
        class_enrollments:[
          {id:'e1',student_id:'ava',class_id:'alg',status:'active',class_grade:91,classes:cls('alg','Algebra')},
          {id:'e2',student_id:'ava',class_id:'bio',status:'active',class_grade:64,classes:cls('bio','Biology')},
          {id:'e3',student_id:'ben',class_id:'alg',status:'active',class_grade:52,classes:cls('alg','Algebra')},
          {id:'e4',student_id:'cy',class_id:'alg',status:'active',class_grade:88,classes:cls('alg','Algebra')}],
        quarter_grade_snapshots:[
          {enrollment_id:'e1',quarter_id:'q1',class_grade:68},{enrollment_id:'e4',quarter_id:'q1',class_grade:59},
          {enrollment_id:'e2',quarter_id:'q1',class_grade:80}],
      },{});
      a.auth.supabase=window.db;a.supabaseQuery=fn=>fn();a.hideLoading=()=>{};
      a.loadGradeBands=async()=>[{code:'jh',label:'Junior high',min_grade:6,max_grade:8},{code:'hs',label:'High school',min_grade:9,max_grade:12}];
      a.userInfo={profile:{id:'admin',user_type:'admin'}};
      window.messages=[];a.showNotification=(message,type)=>window.messages.push({message,type});
    },[iso(q1s),iso(q2s),iso(q3s)]);
    const results=()=>page.innerText('#low-grades-results');
    const rows=()=>page.$$eval('.low-grades-row',rs=>rs.map(r=>r.innerText.replace(/\s+/g,' ').trim()));

    // 1. The admin card opens it on the current quarter, with live grades.
    // Draw the admin dashboard (its other reads come back empty) and press the card.
    await page.evaluate(async()=>{const s=document.getElementById('admin-dashboard-section');if(s)s.style.display='block';await app.renderAdminDashboard();});
    await page.evaluate(()=>{const c=[...document.querySelectorAll('.card')].find(x=>x.getAttribute('onclick')==='app.openLowGrades()');if(!c)throw new Error('no card');c.click();});
    await page.waitForSelector('.low-grades-row');
    assert.equal(await page.inputValue('#low-grades-quarter'),'q2');
    let t=await results();
    assert(t.includes('2 classes at D or below, 2 students, Q2.'),t);
    assert(t.includes('still running'),t);
    assert.deepEqual(await rows(),['Algebra · Jo Fennick 52% F live','Biology · Jo Fennick 64% D live'],'Ben (Alder) before Ava (Brook)');
    // 2. Group by class.
    await page.check('input[name="low-grades-by"][value="class"]');
    assert.deepEqual(await page.$$eval('.low-grades-group > div:first-child',h=>h.map(x=>x.innerText.replace(/\s+/g,' ').trim())),
      ['Algebra · Jo Fennick · 1','Biology · Jo Fennick · 1']);
    await page.check('input[name="low-grades-by"][value="student"]');
    // 3. A past quarter: saved grades only.
    await page.selectOption('#low-grades-quarter','q1');
    await page.waitForFunction(()=>document.querySelector('#low-grades-results').innerText.includes('Q1'));
    t=await results();
    assert(t.includes('2 classes at D or below, 2 students, Q1.') && !t.includes('still running'),t);
    assert.deepEqual(await rows(),['Algebra · Jo Fennick 68% D','Algebra · Jo Fennick 59% F']);
    // 4. Grade band filter: high school only.
    await page.uncheck('.low-grades-band[value="jh"]');
    assert.deepEqual(await rows(),['Algebra · Jo Fennick 59% F']);
    await page.check('.low-grades-band[value="jh"]');
    // 5. One student picked by name.
    await page.fill('#low-grades-find','ava');
    await page.click('.low-grades-pick');
    assert.equal(await page.$$eval('.low-grades-chip',c=>c.length),1);
    assert.deepEqual(await rows(),['Algebra · Jo Fennick 68% D']);
    // 6. CSV of what is shown.
    const [dl]=await Promise.all([page.waitForEvent('download'),page.click('#low-grades-csv')]);
    assert.equal(dl.suggestedFilename(),'d-or-below-Q1.csv');
    const csv=fs.readFileSync(await dl.path(),'utf8').split('\n');
    assert.deepEqual(csv,['Student,Grade level,Class,Subject,Teacher,Percent,Letter,Grade from','Ava Brook,7,Algebra,Math,Jo Fennick,68,D,Saved quarter grade']);
    // 7. Back to everyone; a quarter not started says so.
    await page.click('button:has-text("All students")');
    assert.equal((await rows()).length,2);
    await page.selectOption('#low-grades-quarter','q3');
    await page.waitForFunction(()=>document.querySelector('#low-grades-results').innerText.includes('has not started'));
    assert.equal(await page.isDisabled('#low-grades-csv'),true);
    if(process.env.SHOT){await page.selectOption('#low-grades-quarter','q2');await page.waitForSelector('.low-grades-row');await page.screenshot({path:process.env.SHOT});}
    // 8. Not for teachers.
    await page.evaluate(()=>{app.closeModal('low-grades');app.userInfo={profile:{id:'t1',user_type:'teacher'}};app.openLowGrades();});
    assert.equal(await page.evaluate(()=>messages.at(-1).message),'The D or below check is admin-only');
    assert.deepEqual(errors,[]);
    console.log('D or below: 8 journeys passed.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
