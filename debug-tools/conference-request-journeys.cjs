// Run: python -m http.server 8780, then node debug-tools/conference-request-journeys.cjs
// 2026-11-13, Jordan: a public conference sign-up form - full time or
// homeschool first, then the grade band (junior high / high school only),
// then name, email, students and a time of day - landing in the admin
// conference section as pending, auto-placed first come first served.
// The database functions are stubbed here (supabase/tests in the backend
// repo tests the real ones). Invented people; every external request blocked.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {pagesDatabase}=require('../tests/workbook-pages-fixtures');
const BASE=process.env.BASE_URL||'http://localhost:8780';

// Stands in for shared/supabase.min.js on the public page.
const CLIENT_STUB=`window.supabase={createClient(){return{async rpc(name,args){
  (window.rpcCalls=window.rpcCalls||[]).push({name,args});
  const h=(window.rpcHandlers||{})[name];return h?h(args):{data:null,error:{message:'no stub'}};}};}};`;

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PAGES_CHROME?{executablePath:process.env.PAGES_CHROME}:{}),args:['--no-sandbox']});
  try {
    // ---------------- the public form ----------------
    const page=await browser.newPage({viewport:{width:390,height:844}});   // a phone
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://**',r=>r.abort());
    await page.route('**/shared/supabase.min.js',r=>r.fulfill({contentType:'application/javascript',body:CLIENT_STUB}));
    const DAYS=[{id:'d1',day:'2026-11-20',title:'Parent-teacher conferences',windows:[
      {i:0,label:'Morning',start:'08:20',end:'11:20',open:false},
      {i:1,label:'Midday',start:'11:20',end:'13:20',open:true},
      {i:2,label:'Afternoon',start:'13:20',end:'15:20',open:true},
      {i:3,label:'4:00 PM–5:00 PM',start:'16:00',end:'17:00',open:true}]}];
    await page.addInitScript(days=>{window.rpcHandlers={
      rt_conference_public_days:()=>({data:days,error:null}),
      rt_conference_request:()=>({data:{ok:true},error:null})};},DAYS);
    await page.goto(BASE+'/conferences/');

    // 1. Full time or homeschool comes first; homeschool stops there.
    assert((await page.innerText('main')).includes('full time or homeschool'));
    assert.equal(await page.$('#name'),null,'nothing else asked yet');
    await page.click('button.choice:has-text("Homeschool")');
    assert((await page.innerText('main')).includes('not holding homeschool conferences at this time'));
    assert.equal((await page.evaluate(()=>window.rpcCalls||[])).length,0,'nothing loaded or sent');
    await page.click('text=← Back');

    // 2. Grade band: elementary is turned away; junior high goes on.
    await page.click('button.choice:has-text("Full time")');
    assert((await page.innerText('main')).includes('grade band'));
    await page.click('button:has-text("Elementary")');
    assert((await page.innerText('main')).includes('junior high and high school students only'));
    await page.click('text=← Back');
    await page.click('button:has-text("Junior high")');

    // 3. The rest: the day, the windows (a full one says so), students.
    await page.waitForSelector('#name');
    const text=await page.innerText('main');
    assert(text.includes('Friday, November 20') && text.includes('8:20 AM–11:20 AM') && text.includes('Full. You can still ask'),text);
    assert(text.includes('4:00 PM–5:00 PM') && !text.includes('4:00 PM–5:00 PM 4:00 PM'),'an unnamed block says its times once');
    assert(text.includes('Brothers and sisters are booked back to back'));
    // Checks before sending.
    await page.click('#submit');
    assert((await page.innerText('#error')).includes('your name'));
    await page.fill('#name','Ivo Quillfeather');
    await page.fill('#email','ivo@example');
    await page.click('#submit');
    assert((await page.innerText('#error')).includes('valid email'));
    await page.fill('#email','ivo.q@example.com');
    await page.click('#submit');
    assert((await page.innerText('#error')).includes('student'));
    await page.fill('.student-name','Juno Quillfeather');
    await page.click('#add-student');
    await page.locator('.student-name').nth(1).fill('Bram Quillfeather');
    await page.click('#add-student');   // a blank third row is ignored
    await page.click('#submit');
    assert((await page.innerText('#error')).includes('pick a time'));
    // Back and forward keeps what was typed.
    await page.click('text=← Back');
    await page.click('button:has-text("High school")');
    await page.waitForSelector('#name');
    assert.equal(await page.inputValue('#name'),'Ivo Quillfeather');
    assert.equal(await page.locator('.student-name').count(),3);
    await page.click('label.window:has-text("Midday")');
    await page.fill('#notes','Either parent can come');
    await page.click('#submit');
    await page.waitForSelector('text=Request received');
    const sent=(await page.evaluate(()=>window.rpcCalls)).find(c=>c.name==='rt_conference_request');
    assert.deepEqual(sent.args,{p_day:'d1',p_program:'full_time',p_band:'high_school',p_name:'Ivo Quillfeather',p_email:'ivo.q@example.com',
      p_students:['Juno Quillfeather','Bram Quillfeather'],p_window:1,p_notes:'Either parent can come',p_trap:null});
    assert((await page.innerText('main')).includes('ivo.q@example.com'));

    // 4. A refusal from the database is shown in its own words; the form stays.
    await page.evaluate(()=>{window.rpcHandlers.rt_conference_request=()=>({data:null,error:{code:'22023',message:'Sign-up for that day is closed'}});});
    await page.reload();
    await page.click('button.choice:has-text("Full time")');await page.click('button:has-text("High school")');
    await page.waitForSelector('#name');
    await page.evaluate(()=>{window.rpcHandlers.rt_conference_request=()=>({data:null,error:{code:'22023',message:'Sign-up for that day is closed'}});});
    await page.fill('#name','A');await page.fill('#email','a@example.com');await page.fill('.student-name','B C');
    await page.click('label.window:has-text("Afternoon")');await page.click('#submit');
    await page.waitForFunction(()=>document.getElementById('error').textContent.includes('closed'));
    assert.equal(await page.isDisabled('#submit'),false);
    // 5. No open day.
    await page.evaluate(()=>{window.rpcHandlers.rt_conference_public_days=()=>({data:[],error:null});});
    await page.evaluate(()=>{state.days=null;stepDetails();});
    await page.waitForSelector('text=not open right now');
    assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)),'no sideways scroll on a phone');
    if (process.env.SHOT) { await page.evaluate(()=>{state.days=null;window.rpcHandlers.rt_conference_public_days=()=>({data:[{id:'d1',day:'2026-11-20',title:'Parent-teacher conferences',windows:[{i:0,label:'Morning',start:'08:20',end:'11:20',open:false},{i:1,label:'Midday',start:'11:20',end:'13:20',open:true}]}],error:null});stepDetails();});
      await page.waitForSelector('#name');await page.screenshot({path:process.env.SHOT.replace('.png','-form.png'),fullPage:true}); }
    assert.deepEqual(errors,[]);

    // ---------------- the public form, with open times (2026-11-17) ----------------
    // "have the form reveal available time slots instead of blocks"
    const tp=await browser.newPage({viewport:{width:390,height:844}});
    const terr=[];tp.on('pageerror',e=>terr.push(e.message));
    await tp.route('https://**',r=>r.abort());
    await tp.route('**/shared/supabase.min.js',r=>r.fulfill({contentType:'application/javascript',body:CLIENT_STUB}));
    const T=(a,b)=>({start:a,end:b});
    const TDAYS=[{id:'d1',day:'2026-11-20',title:'Parent-teacher conferences',
      windows:[{i:0,label:'Morning',start:'08:20',end:'11:20',open:true},{i:1,label:'Afternoon',start:'15:00',end:'16:40',open:true}],
      // 8:20 and 8:40 back to back; 10:00 alone; 3:20, 3:40, 4:00 in a row; 4:40 in no block.
      times:[T('08:20','08:40'),T('08:40','09:00'),T('10:00','10:20'),T('15:20','15:40'),T('15:40','16:00'),T('16:00','16:20'),T('16:40','17:00')]}];
    await tp.addInitScript(days=>{window.rpcHandlers={
      rt_conference_public_days:()=>({data:days,error:null}),
      rt_conference_request:()=>({data:{ok:true},error:null})};},TDAYS);
    await tp.goto(BASE+'/conferences/');
    await tp.click('button.choice:has-text("Full time")');await tp.click('button:has-text("High school")');
    await tp.waitForSelector('#name');
    const chips=()=>tp.$$eval('.time span',x=>x.map(e=>e.textContent));
    const heads=()=>tp.$$eval('.time-group h3',x=>x.map(e=>e.textContent));
    // 6. One student: every open time, under its block; one outside any block under "Other times".
    assert.deepEqual(await chips(),['8:20 AM','8:40 AM','10:00 AM','3:20 PM','3:40 PM','4:00 PM','4:40 PM']);
    assert.deepEqual(await heads(),['Morning · 8:20 AM–11:20 AM','Afternoon · 3:00 PM–4:40 PM','Other times']);
    assert.equal(await tp.innerText('#time-label'),'Pick a time');
    // 7. Two students: only times with another straight after.
    await tp.fill('#name','Maud Ashby');await tp.fill('#email','maud@example.com');
    await tp.fill('.student-name','Corin Ashby');
    await tp.click('.time:has-text("10:00 AM")');
    await tp.click('#add-student');await tp.locator('.student-name').nth(1).fill('Dell Ashby');
    assert.deepEqual(await chips(),['8:20 AM','3:20 PM','3:40 PM']);
    assert.equal(await tp.innerText('#time-label'),'Pick a time (your 2 students go back to back from it)');
    // The 10:00 pick no longer fits, so it is not kept.
    await tp.click('#submit');
    assert((await tp.innerText('#error')).includes('pick a time'));
    // Three: only 3:20 (3:20, 3:40, 4:00).
    await tp.click('#add-student');await tp.locator('.student-name').nth(2).fill('Fen Ashby');
    assert.deepEqual(await chips(),['3:20 PM']);
    await tp.locator('.student-name').nth(2).fill('');
    assert.deepEqual(await chips(),['8:20 AM','3:20 PM','3:40 PM'],'a name cleared gives the times back');
    // 8. Send 3:40: the time goes, no block.
    await tp.click('.time:has-text("3:40 PM")');
    await tp.click('#submit');
    await tp.waitForSelector('text=Request received');
    let tsent=(await tp.evaluate(()=>window.rpcCalls)).find(c=>c.name==='rt_conference_request');
    assert.deepEqual(tsent.args,{p_day:'d1',p_program:'full_time',p_band:'high_school',p_name:'Maud Ashby',p_email:'maud@example.com',
      p_students:['Corin Ashby','Dell Ashby'],p_window:null,p_notes:null,p_trap:null,p_time:'15:40'});
    assert((await tp.innerText('main')).includes('Friday, November 20 at 3:40 PM'));
    // 9. Taken meanwhile: the message, the times as they are now, and what was typed kept.
    await tp.reload();
    await tp.click('button.choice:has-text("Full time")');await tp.click('button:has-text("High school")');
    await tp.waitForSelector('#name');
    await tp.fill('#name','Maud Ashby');await tp.fill('#email','maud@example.com');await tp.fill('.student-name','Corin Ashby');
    await tp.click('.time:has-text("8:20 AM")');
    await tp.evaluate(()=>{window.rpcHandlers.rt_conference_request=()=>({data:null,error:{code:'22023',message:'Someone just took that time. Please pick another.'}});
      const now=JSON.parse(JSON.stringify(window.rpcHandlers.rt_conference_public_days().data));now[0].times=now[0].times.slice(1);
      window.rpcHandlers.rt_conference_public_days=()=>({data:now,error:null});});
    await tp.click('#submit');
    await tp.waitForFunction(()=>document.getElementById('error').textContent.includes('Someone just took that time'));
    await tp.waitForFunction(()=>!document.querySelector('.time input[value="08:20"]'));
    assert.equal(await tp.inputValue('#name'),'Maud Ashby');
    assert.equal(await tp.isDisabled('#submit'),false);
    // 10. None of the times work: sent with no time and no block.
    await tp.evaluate(()=>{window.rpcHandlers.rt_conference_request=()=>({data:{ok:true},error:null});});
    await tp.click('label.window:has-text("None of these times work")');
    await tp.click('#submit');
    await tp.waitForSelector('text=Request received');
    tsent=(await tp.evaluate(()=>window.rpcCalls)).filter(c=>c.name==='rt_conference_request').at(-1);
    assert.equal(tsent.args.p_time,null);assert.equal(tsent.args.p_window,null);
    // 11. Nothing left for two: says so, and still lets them ask.
    await tp.evaluate(()=>{window.rpcHandlers.rt_conference_public_days=()=>({data:[{id:'d1',day:'2026-11-20',title:'x',windows:[],times:[{start:'10:00',end:'10:20'}]}],error:null});
      state.days=null;state.students=['A B','C D'];stepDetails();});
    await tp.waitForSelector('text=no 2 back-to-back times left');
    assert(await tp.isVisible('label.window:has-text("None of these times work")'));
    assert(!(await tp.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)),'no sideways scroll on a phone');
    if (process.env.SHOT) { await tp.evaluate(days=>{window.rpcHandlers.rt_conference_public_days=()=>({data:days,error:null});state.days=null;state.students=['Corin Ashby'];stepDetails();},TDAYS);
      await tp.waitForSelector('.time');await tp.screenshot({path:process.env.SHOT.replace('.png','-times.png'),fullPage:true}); }
    assert.deepEqual(terr,[]);
    await tp.close();

    // ---------------- the admin conference section ----------------
    const admin=await browser.newPage({viewport:{width:1200,height:900}});
    const aerr=[];admin.on('pageerror',e=>aerr.push(e.message));
    await admin.route('https://**',r=>r.abort());
    await admin.goto(BASE+'/portal/index.html');
    await admin.waitForFunction(()=>window.app?.auth);
    await admin.evaluate(`window.makeDb=${pagesDatabase.toString()}`);
    const seed={
      conference_days:[{id:'d1',day:'2099-11-20',title:'Parent-teacher conferences',is_open:true,finalized_at:null,
        public_form:true,request_windows:[{label:'Morning',start:'08:20',end:'11:20'},{label:'Midday',start:'11:20',end:'13:20'}]},
        {id:'d2',day:'2099-11-21',title:'Second day',is_open:false,finalized_at:null,public_form:false,request_windows:[{label:'Morning',start:'08:20',end:'11:20'}]}],
      conference_slots:[
        {id:'s1',day_id:'d1',starts_at:'08:20:00',ends_at:'08:40:00',teacher_ids:['tm'],assigned_teacher_ids:['tm'],teachers_matched:true,student_id:'juno',booked_by:null,booked_at:'2099-11-01T10:00:00Z',contact_email:null,confirmed_at:null,location_id:null},
        {id:'s2',day_id:'d1',starts_at:'08:40:00',ends_at:'09:00:00',teacher_ids:['tm'],assigned_teacher_ids:null,teachers_matched:null,student_id:null,booked_by:null,booked_at:null,contact_email:null,confirmed_at:null,location_id:null},
        {id:'s2b',day_id:'d1',starts_at:'08:40:00',ends_at:'09:00:00',teacher_ids:['tx'],assigned_teacher_ids:['tx'],teachers_matched:false,student_id:'bram',booked_by:null,booked_at:'2099-11-01T10:00:00Z',contact_email:null,confirmed_at:null,location_id:null},
        {id:'s3',day_id:'d1',starts_at:'09:00:00',ends_at:'09:20:00',teacher_ids:['tm'],assigned_teacher_ids:['tm'],teachers_matched:true,student_id:'pip',booked_by:'par2',booked_at:'2099-11-01T09:00:00Z',contact_email:null,confirmed_at:null,location_id:null}],
      conference_requests:[
        {id:'q1',day_id:'d1',program:'full_time',grade_band:'high_school',parent_name:'Ivo Quillfeather',email:'ivo.q@example.com',students:['Juno','Mystery Kid'],
         window_label:'Morning',window_start:'08:20:00',window_end:'11:20:00',notes:'Either parent can come',email_known:true,status:'pending',decided_at:null,created_at:'2099-11-01T10:00:00Z',
         placements:[{typed:'Juno',student_id:'juno',how:'parent_email',slot_id:'s1',note:'held',together:true},{typed:'Bram',student_id:'bram',how:'parent_email',slot_id:'s2b',note:'held',together:true},{typed:'Mystery Kid',student_id:null,how:null,slot_id:null,note:'no student found with this name'},{typed:'Pim',student_id:'pim',how:'parent_email',slot_id:null,note:'not in junior high or high school',grade:'1'}]},
        {id:'q2',day_id:'d1',program:'full_time',grade_band:'junior_high',parent_name:'Someone',email:'x@example.com',students:['Pip Larkin'],
         window_label:'Morning',window_start:'08:20:00',window_end:'11:20:00',notes:null,email_known:false,status:'declined',decided_at:'2099-11-02T10:00:00Z',created_at:'2099-11-01T11:00:00Z',
         placements:[{typed:'Pip Larkin',student_id:'pip',how:'name',slot_id:'s3',note:'already booked'}]}],
      user_profiles:[
        {id:'admin',first_name:'Office',last_name:'Admin',user_type:'admin'},
        {id:'tm',first_name:'Wren',last_name:'Halloway',user_type:'teacher',account_status:'active'},
        {id:'juno',first_name:'Juno',last_name:'Quillfeather',user_type:'student',grade_level:'10'},
        {id:'bram',first_name:'Bram',last_name:'Quillfeather',user_type:'student',grade_level:'8'},
        {id:'tx',first_name:'Basil',last_name:'Thorne',user_type:'teacher',account_status:'active'},
        {id:'pip',first_name:'Pip',last_name:'Larkin',user_type:'student',grade_level:'7'},
        {id:'par',first_name:'Ivo',last_name:'Quillfeather',user_type:'parent',email:'ivo.q@example.com'},
        {id:'par2',first_name:'Moss',last_name:'Larkin',user_type:'parent',email:'moss@example.com'}],
      parent_child_links:[{id:'l1',parent_id:'par',child_id:'juno'},{id:'l3',parent_id:'par',child_id:'bram'},{id:'l2',parent_id:'par2',child_id:'pip'}],
      classes:[],class_enrollments:[],conference_locations:[]};
    const setupAdmin=async(faults)=>admin.evaluate(([seed,faults])=>{
      const a=window.app;window.db=window.makeDb(seed,faults);
      window.rpcCalls=[];window.db.rpc=async(name,args)=>{window.rpcCalls.push({name,args});
        if(name==='rt_conference_request_decide')return{data:{ok:true,slots:args.p_action==='reopen'?0:1},error:null};
        if(name==='rt_confirm_conference_day')return{data:{sent:1,notifications:1,emails:1,teachers:1,nobody_to_tell:[],pending_requests:1},error:null};
        return{data:null,error:{message:'no stub'}};};
      a.auth.supabase=window.db;a.supabaseQuery=fn=>fn();a.hideLoading=()=>{};
      a.userInfo={profile:{id:'admin',user_type:'admin'}};
      window.messages=[];a.showNotification=(message,type)=>window.messages.push({message,type});
      window.confirm=()=>true;
    },[seed,faults||{}]);

    // 6. The pending request, what matched, and the held time.
    await setupAdmin();
    await admin.evaluate(()=>app.openConferenceAdmin());
    await admin.waitForSelector('.conf-requests');
    const body=await admin.innerText('#conf-admin-body');
    assert(body.includes('rivertech.me/conferences/'),'form link');
    assert(/Sign-up requests\s*1 pending, 1 decided/.test(body),body.slice(0,600));
    assert(body.includes('Ivo Quillfeather') && body.includes('a parent account has this email'));
    assert(body.includes('“Juno” → Juno Quillfeather (matched by parent email), held: 8:20 AM–8:40 AM back to back'),body);
    assert(body.includes('“Bram” → Bram Quillfeather (matched by parent email), held: 8:40 AM–9:00 AM back to back'));
    assert(body.includes('no student found with this name: add them to a time yourself'));
    // A brother or sister outside grades 6-12: listed with the reason, nothing to do.
    assert(body.includes('“Pim” → no time: grade 1 is not junior high or high school'),body);
    assert(body.includes('sign-up form, waiting for approval'),'held slot labelled in the grid');
    assert(body.includes('2 times are held by sign-up requests not approved yet'),'review warns');
    // The held time is not counted to send; Pip's parent booking is.
    assert(body.includes('Finalize & send 1 confirmation'),body.match(/Finalize[^\n]*/)?.[0]);
    assert(body.includes('Public form times Morning 8:20 AM–11:20 AM · Midday 11:20 AM–1:20 PM'),'times summary');
    assert(body.includes('On the form now: Friday, November 20, 2099.'),'which days are on the form');
    assert(body.includes('(day not on the form)'),'second day marked off the form');

    // 7. Approve and decline call the database; Finalize reports what it left out.
    await admin.click('.conf-request >> text=Approve');
    await admin.waitForFunction(()=>window.rpcCalls.some(c=>c.name==='rt_conference_request_decide'));
    assert.deepEqual((await admin.evaluate(()=>window.rpcCalls))[0].args,{p_request:'q1',p_action:'approve'});
    assert((await admin.evaluate(()=>window.messages.at(-1).message)).includes('their email is on 1 time'));
    await admin.evaluate(()=>app.confirmConferenceDay('d1'));
    assert((await admin.evaluate(()=>window.messages.at(-1).message)).includes('1 time held by sign-up requests not approved yet was left out'));

    // 8. Edit the windows: add one, save, bad input refused.
    await admin.locator('.conf-windows summary').first().click();
    await admin.locator('.conf-windows').first().locator('text=➕ Block').click();
    const rows=admin.locator('#conf-wins-d1 > div');
    assert.equal(await rows.count(),3);
    await rows.nth(2).locator('.conf-win-label').fill('Afternoon');
    await rows.nth(2).locator('.conf-win-start').fill('14:00');
    await rows.nth(2).locator('.conf-win-end').fill('13:00');
    await admin.locator('.conf-windows').first().locator('text=Save times').click();
    assert((await admin.evaluate(()=>window.messages.at(-1).message)).includes('"Afternoon" has to start before it ends'));
    await rows.nth(2).locator('.conf-win-end').fill('15:20');
    await admin.locator('.conf-windows').first().locator('text=Save times').click();
    await admin.waitForFunction(()=>/^Saved, but .* has no slots/.test(window.messages.at(-1).message));
    assert.deepEqual(await admin.evaluate(()=>db.tables.conference_days[0].request_windows.map(w=>w.label+' '+w.start+'-'+w.end)),
      ['Morning 08:20-11:20','Midday 11:20-13:20','Afternoon 14:00-15:20']);
    if (process.env.SHOT) await admin.locator('#conf-admin-body').screenshot({path:process.env.SHOT.replace('.png','-admin.png')});

    // 8a. Time blocks: 8:00-12:00 in hours, one left unnamed; overlapping blocks refused.
    const win0=admin.locator('.conf-windows').first();
    await win0.locator('summary').first().click();
    await admin.fill('#conf-blk-start-d1','08:00');await admin.fill('#conf-blk-end-d1','12:00');
    await admin.selectOption('#conf-blk-len-d1','60');
    await win0.locator('button:has-text("Make blocks")').click();
    assert.equal(await admin.locator('#conf-wins-d1 > div').count(),4);
    await admin.locator('#conf-wins-d1 .conf-win-label').first().fill('Early');
    await win0.locator('text=Save times').click();
    await admin.waitForFunction(()=>/^Saved, but .* has no slots/.test(window.messages.at(-1).message));
    assert.deepEqual(await admin.evaluate(()=>db.tables.conference_days[0].request_windows.map(w=>w.label+' '+w.start+'-'+w.end)),
      ['Early 08:00-09:00','9:00 AM–10:00 AM 09:00-10:00','10:00 AM–11:00 AM 10:00-11:00','11:00 AM–12:00 PM 11:00-12:00']);
    // One block 8:20-10:20 overlapping 9-10 is refused.
    await admin.locator('.conf-windows summary').first().click();
    await admin.locator('.conf-windows').first().locator('text=➕ Block').click();
    const last=admin.locator('#conf-wins-d1 > div').last();
    await last.locator('.conf-win-start').fill('08:20');await last.locator('.conf-win-end').fill('10:20');
    await admin.locator('.conf-windows').first().locator('text=Save times').click();
    assert((await admin.evaluate(()=>window.messages.at(-1).message)).includes('overlap'));
    // Just 8:20-10:20, alone, is fine.
    await admin.evaluate(()=>{const rows=[...document.querySelectorAll('#conf-wins-d1 > div')];rows.slice(0,-1).forEach(r=>r.remove());});
    await admin.locator('.conf-windows').first().locator('text=Save times').click();
    await admin.waitForFunction(()=>/^Saved, but .* has no slots/.test(window.messages.at(-1).message));
    assert.deepEqual(await admin.evaluate(()=>db.tables.conference_days[0].request_windows),[{label:'8:20 AM–10:20 AM',start:'08:20',end:'10:20'}]);

    // 8b. Pick the days: the second day has no slots, so it cannot go on the form yet.
    const onForm=admin.locator('.conf-on-form');
    assert.equal(await onForm.count(),2);
    await onForm.nth(1).click();   // refused, so the tick does not stay
    await admin.waitForFunction(()=>/Add time slots first/.test(window.messages.at(-1).message));
    assert.equal(await admin.evaluate(()=>db.tables.conference_days[1].public_form),false);
    // Take the first day off, and put it back.
    await admin.locator('.conf-on-form').first().click();
    await admin.waitForFunction(()=>window.messages.at(-1).message==='Taken off the public form');
    assert.equal(await admin.evaluate(()=>db.tables.conference_days[0].public_form),false);
    await admin.locator('.conf-on-form').first().click();
    await admin.waitForFunction(()=>window.messages.at(-1).message==='This day is now on the public form');
    assert.equal(await admin.evaluate(()=>db.tables.conference_days[0].public_form),true);

    // 8c. Time gaps: 20-minute slots with 5 minutes between.
    // (Its "Add time slots" is already open: a day with no slots opens it.)
    await admin.fill('#conf-start-d2','08:20');await admin.fill('#conf-end-d2','11:20');
    await admin.fill('#conf-len-d2','20');await admin.fill('#conf-gap-d2','5');
    assert.equal(await admin.innerText('#conf-preview-d2'),'7 slots, 8:20 AM–11:10 AM (10 min left over)');
    await admin.locator('.conf-teacher-d2').first().check();
    await admin.locator('#conf-add-d2 button:has-text("Add slots")').click();
    await admin.waitForFunction(()=>/7 slots added/.test(window.messages.at(-1).message));
    assert.deepEqual(await admin.evaluate(()=>db.tables.conference_slots.filter(x=>x.day_id==='d2').map(x=>x.starts_at).slice(0,3)),['08:20','08:45','09:10']);
    // Match my slots fills the second day's windows from them; then it can go on the form.
    await admin.locator('.conf-windows summary').nth(1).click();
    await admin.locator('.conf-windows').nth(1).locator('text=Match my slots').click();
    assert.equal(await admin.locator('#conf-wins-d2 .conf-win-end').first().inputValue(),'11:10');
    await admin.locator('.conf-windows').nth(1).locator('text=Save times').click();
    await admin.waitForFunction(()=>window.messages.at(-1).message==='Public form times saved');
    assert.deepEqual(await admin.evaluate(()=>db.tables.conference_days[1].request_windows),[{label:'Morning',start:'08:20',end:'11:10'}]);
    await admin.locator('.conf-on-form').nth(1).click();
    await admin.waitForFunction(()=>window.messages.at(-1).message==='This day is now on the public form');
    assert.equal(await admin.evaluate(()=>db.tables.conference_days[1].public_form),true);

    // 8d. Blocks that run past the slots (2026-11-17: blocks to 4:40, slots
    //     ending 3:20, so the afternoon's families got no time). The day says
    //     so, and one press fills in "Add time slots" for the gap.
    await admin.evaluate(()=>app.closeModal('conferences'));
    const wed=JSON.parse(JSON.stringify(seed));
    wed.conference_days=[{...seed.conference_days[0],request_windows:[{label:'Morning',start:'08:20',end:'09:20'},{label:'Afternoon',start:'15:00',end:'16:00'}]}];
    wed.conference_slots=[...seed.conference_slots,
      {id:'s4',day_id:'d1',starts_at:'09:20:00',ends_at:'09:40:00',teacher_ids:['tm'],student_id:null},
      {id:'s5',day_id:'d1',starts_at:'15:00:00',ends_at:'15:20:00',teacher_ids:['tm'],student_id:null}];
    wed.conference_requests=[{...seed.conference_requests[0],id:'q3',status:'approved',window_label:'Afternoon',
      placements:[{typed:'Pip',student_id:'pip',slot_id:null,note:'no free time left in this window'},{typed:'Wanda',student_id:'wanda',slot_id:null,note:'no free time left in this window'}]}];
    wed.user_profiles=[...seed.user_profiles,{id:'wanda',first_name:'Wanda',last_name:'Fenn',user_type:'student',grade_level:'9'}];
    await admin.evaluate(([w])=>{window.db=window.makeDb(w,{});window.db.rpc=async()=>({data:null,error:{message:'no stub'}});app.auth.supabase=window.db;},[wed]);
    await admin.evaluate(()=>app.openConferenceAdmin());
    await admin.waitForSelector('.conf-time-check');
    const check=(await admin.innerText('.conf-time-check')).replace(/\s+/g,' ');
    assert(check.includes('Afternoon has no slots 3:20 PM–4:00 PM'),check);
    assert(check.includes('in no public-form block, so the form never offers it: 9:20 AM–9:40 AM'),check);
    // Pip has a time already (booked by a parent); Wanda is still waiting.
    assert(check.includes('1 student from sign-up requests found no free time and has none yet'),check);
    // "Add time slots" offers the day's own blocks.
    assert.deepEqual(await admin.$$eval('#conf-zone-d1 option',o=>o.map(x=>x.textContent.trim())),
      ['Morning (8:20 AM–9:20 AM)','Afternoon (3:00 PM–4:00 PM)','Custom times']);
    await admin.click('.conf-time-check button:has-text("Add slots for this")');
    assert.equal(await admin.inputValue('#conf-start-d1'),'15:20');
    assert.equal(await admin.inputValue('#conf-end-d1'),'16:00');
    assert.equal(await admin.inputValue('#conf-len-d1'),'20');
    assert.equal(await admin.innerText('#conf-preview-d1'),'2 slots, 3:20 PM–4:00 PM');
    // The teachers already on the day are the ones ticked.
    assert.deepEqual(await admin.$$eval('.conf-teacher-d1:checked',b=>b.map(x=>x.value).sort()),['tm','tx']);
    assert.equal(await admin.evaluate(()=>db.tables.conference_slots.length),6,'nothing added before pressing Add slots');
    await admin.locator('#conf-add-d1 button:has-text("Add slots")').click();
    await admin.waitForFunction(()=>/2 slots added/.test(window.messages.at(-1).message));
    assert(!(await admin.innerText('#conf-admin-body')).includes('Afternoon has no slots'),'warning gone once covered');
    // Saving blocks wider than the slots says so at once.
    await admin.locator('.conf-windows summary').first().click();
    await admin.locator('#conf-wins-d1 .conf-win-end').last().fill('16:40');
    await admin.locator('.conf-windows').first().locator('text=Save times').click();
    await admin.waitForFunction(()=>/^Saved, but Afternoon has no slots 4:00 PM–4:40 PM/.test(window.messages.at(-1).message));
    assert.equal(await admin.evaluate(()=>window.messages.at(-1).type),'warning');
    await admin.evaluate(()=>app.closeModal('conferences'));

    // 9. Before the database update: the screen still works, and says the form is not on yet.
    await admin.evaluate(()=>app.closeModal('conferences'));
    await setupAdmin({'conference_requests:select':1});
    await admin.evaluate(()=>app.openConferenceAdmin());
    await admin.waitForSelector('text=Add time slots');
    const before=await admin.innerText('#conf-admin-body');
    assert(before.includes('once the database update for it is applied') && !before.includes('Sign-up requests') && !before.includes('On the public form'),'degrades');
    assert(before.includes('Finalize & send 3 confirmations'),'nothing held without requests');
    assert.deepEqual(aerr,[]);
    console.log('Conference requests: 19 journeys passed (public form on a phone, admin section).');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
