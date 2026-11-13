// Run: python -m http.server 8780, then node debug-tools/skill-start-point-journey.cjs
// 2026-11-12, Jordan: "let's have a teacher set point." Student Hub > Skill
// Trees > Set starting point, as a teacher: pick a skill, see what it marks,
// save it. Invented student; every external request is blocked. The database
// function is stubbed here; supabase/tests in the backend repo tests the real one.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {pagesDatabase}=require('../tests/workbook-pages-fixtures');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PAGES_CHROME?{executablePath:process.env.PAGES_CHROME}:{}),args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://**',r=>r.abort());
    await page.goto(process.env.PORTAL_URL || 'http://localhost:8780/portal/index.html');
    await page.waitForFunction(()=>window.app?.auth);
    await page.evaluate(`window.makeDb=${pagesDatabase.toString()}`);
    const setup=async(userType,rpc)=>page.evaluate(([userType,rpc])=>{
      const a=window.app;
      window.db=window.makeDb({skill_progress:[
        {id:'1',user_id:'ivy',subject:'Math',skill_name:'Counting and Number Recognition',state:'mastered',mastery_score:95,source:'practice'},
        {id:'2',user_id:'ivy',subject:'Math',skill_name:'Teen Numbers',state:'in_progress',mastery_score:40,source:'dojo'}],
        skill_progress_history:[],math_dojo_sessions:[]});
      window.rpcCalls=[];
      window.db.rpc=async(name,args)=>{window.rpcCalls.push({name,args});
        return rpc==='missing'?{data:null,error:{code:'PGRST202',message:'Could not find the function public.rt_teacher_set_skill_start'}}
                              :{data:{marked:args.p_skills.length,already:0},error:null};};
      a.auth.supabase=window.db;a.supabaseQuery=fn=>fn();
      a.userInfo={profile:{id:'t1',user_type:userType}};
      window.messages=[];a.showNotification=(message,type)=>window.messages.push({message,type});
      document.body.insertAdjacentHTML('beforeend','<div id="student-hub-tab-content"></div>');
      document.getElementById('student-hub-tab-content').innerHTML='';
      a._studentHubData={student:{id:'ivy',first_name:'Ivy',last_name:'Marsh'},enrollments:[]};a._studentHubId='ivy';
      a.renderStudentHubSkillsTab();
    },[userType,rpc]);

    // 1. A teacher sees the button on Math; the old override code is gone.
    await setup('teacher');
    await page.waitForSelector('#skill-start-bar');
    assert.equal(await page.isVisible('#skill-start-bar'),true);
    assert(!(await page.content()).includes('Override Code'),'old code note removed');
    // Not on another subject.
    await page.waitForTimeout(150);
    await page.selectOption('#skill-subject-select','Art');
    assert.equal(await page.isVisible('#skill-start-bar'),false,'Math only');
    await page.selectOption('#skill-subject-select','Math');
    assert.equal(await page.isVisible('#skill-start-bar'),true);

    // 2. Pick a skill: search narrows, the preview counts, mastered is left alone.
    await page.click('text=🎯 Set starting point');
    await page.waitForSelector('#skill-start-select');
    assert.equal(await page.isDisabled('#skill-start-confirm'),true);
    assert((await page.$$eval('#skill-start-select option',os=>os.map(o=>o.textContent))).some(t=>/Counting and Number Recognition .*✓$/.test(t)),'mastered skills are ticked');
    await page.fill('#skill-start-search','place value');
    const shown=await page.$$eval('#skill-start-select option',os=>os.filter(o=>!o.hidden).map(o=>o.textContent));
    assert(shown.length>=1 && shown.every(t=>/place value/i.test(t)),shown.join('|'));
    const id=await page.$eval('#skill-start-select option:not([hidden])',o=>o.value);
    await page.selectOption('#skill-start-select',id);
    const preview=await page.innerText('#skill-start-preview');
    assert(/Marks \d+ skills? mastered \(1 already mastered and left alone/.test(preview),preview);
    assert.equal(await page.isDisabled('#skill-start-confirm'),false);
    // A root skill: nothing to mark.
    await page.fill('#skill-start-search','');
    await page.selectOption('#skill-start-select','M-001');
    assert((await page.innerText('#skill-start-preview')).includes('needs nothing first'));
    assert.equal(await page.isDisabled('#skill-start-confirm'),true);

    // 3. Save: one call, the right student, only the unmastered names.
    await page.selectOption('#skill-start-select',id);
    await page.click('#skill-start-confirm');
    await page.waitForFunction(()=>window.messages.length>0);
    const call=(await page.evaluate(()=>window.rpcCalls))[0];
    assert.equal(call.name,'rt_teacher_set_skill_start');
    assert.equal(call.args.p_student,'ivy');assert.equal(call.args.p_subject,'Math');
    assert(call.args.p_skills.includes('Teen Numbers') && !call.args.p_skills.includes('Counting and Number Recognition'),JSON.stringify(call.args.p_skills));
    const msg=(await page.evaluate(()=>window.messages.at(-1)));
    assert.equal(msg.type,'success');assert(msg.message.startsWith('Starting point set at'),msg.message);
    assert.equal(await page.$('#modal-skill-start'),null,'closed');

    // 4. Before the database update is applied: a plain message, the dialog stays.
    await setup('teacher','missing');
    await page.waitForSelector('#skill-start-bar');
    await page.click('text=🎯 Set starting point');
    await page.waitForSelector('#skill-start-select');
    await page.selectOption('#skill-start-select',id);
    await page.click('#skill-start-confirm');
    await page.waitForFunction(()=>window.messages.length>0);
    assert((await page.evaluate(()=>window.messages.at(-1).message)).includes('not switched on yet'));
    assert(await page.$('#modal-skill-start'),'dialog kept open');
    assert.equal(await page.isDisabled('#skill-start-confirm'),false,'can retry');
    if (process.env.SHOT) await page.screenshot({path:process.env.SHOT});
    await page.evaluate(()=>app.closeModal('skill-start'));

    // 5. A parent opening the hub gets no button.
    await setup('parent');
    await page.waitForSelector('#skill-subject-select');
    assert.equal(await page.$('#skill-start-bar'),null);

    assert.deepEqual(errors,[]);
    console.log('Set starting point: 5 journeys passed.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
