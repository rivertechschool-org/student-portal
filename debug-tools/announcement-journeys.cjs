// Run: python -m http.server 8780, then node debug-tools/announcement-journeys.cjs
// 2026-11-15, Jordan: "an announcement banner that can be closed and is on
// first load and admin can set the events and put it on a schedule so they
// dont have to turn it off" - plus the automatic "conferences are this week".
// The database call is stubbed (supabase/tests/announcements.sql in the
// backend repo tests the real one). Invented content; every other external
// request is blocked.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {pagesDatabase}=require('../tests/workbook-pages-fixtures');
const BASE=process.env.BASE_URL||'http://localhost:8780';

const iso=(d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const inDays=(n)=>{const d=new Date();d.setDate(d.getDate()+n);return iso(d);};

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PAGES_CHROME?{executablePath:process.env.PAGES_CHROME}:{}),args:['--no-sandbox']});
  try {
    // ---------------- the sign-in page, on a phone, signed out ----------------
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let live={viewer:'visitors',conferences:[{id:'d1',day:inDays(3)}],announcements:[
      {id:'n1',message:'Picture day is Thursday.',link_url:null,link_label:null,tone:'info',updated_at:'t1'},
      {id:'n2',message:'Snow: school is closed today.',link_url:'https://example.com/snow',link_label:'Details',tone:'important',updated_at:'t1'}]};
    const calls=[];
    await page.route('https://**',r=>{
      const u=r.request().url();
      if(u.includes('/rest/v1/rpc/rt_announcements_live')){calls.push(r.request().headers());return r.fulfill({contentType:'application/json',body:JSON.stringify(live)});}
      return r.abort();
    });
    await page.goto(BASE+'/');
    await page.waitForSelector('#announcement-banners');
    const texts=async()=>page.$$eval('.announcement-banner',bs=>bs.map(b=>b.innerText.replace(/\s+/g,' ').trim()));
    let t=await texts();
    // 1. On first load, important first, then the conference banner with who and a link.
    assert.equal(t.length,3,JSON.stringify(t));
    assert(t[0].includes('Snow: school is closed today.'),t[0]);
    assert(t[1].includes('Parent-teacher conferences are this week') && t[1].includes('For full-time junior high and high school families.') && t[1].includes('Sign up for a time'),t[1]);
    assert.equal(await page.getAttribute('.announcement-banner:nth-child(2) .announcement-link','href'),'/conferences/');
    assert.equal(calls[0].authorization,undefined,'signed out asks as a visitor');
    // It sits above the page heading.
    const above=await page.evaluate(()=>document.querySelector('#announcement-banners').getBoundingClientRect().top<document.querySelector('.header h1').getBoundingClientRect().top);
    assert(above,'banner is at the top');
    // 2. Close one: gone, and still gone after a reload.
    await page.click('.announcement-banner:has-text("Picture day") .announcement-close');
    assert.equal((await texts()).length,2);
    await page.reload();await page.waitForSelector('#announcement-banners');
    assert(!(await texts()).some(x=>x.includes('Picture day')),'closed stays closed');
    // 3. The admin edits it: it shows again.
    live.announcements[0]={...live.announcements[0],message:'Picture day moved to Friday.',updated_at:'t2'};
    await page.reload();await page.waitForSelector('#announcement-banners');
    assert((await texts()).some(x=>x.includes('Picture day moved to Friday.')),'edited shows again');
    // 4. Its schedule ended (the server stops returning it): gone with nobody touching it.
    live={...live,announcements:[live.announcements[1]],conferences:[]};
    await page.reload();await page.waitForSelector('#announcement-banners');
    assert.deepEqual((await texts()).length,1);
    // 5. Nothing live: no banner, no empty box.
    live={viewer:'visitors',conferences:[],announcements:[]};
    await page.reload();await page.waitForTimeout(400);
    assert.equal(await page.$('#announcement-banners'),null);
    if(process.env.SHOT){live={viewer:'visitors',conferences:[{id:'d1',day:inDays(3)}],announcements:[{id:'n2',message:'Snow: school is closed today.',link_url:'https://example.com/snow',link_label:'Details',tone:'important',updated_at:'t9'},{id:'n3',message:'Picture day is Friday.',tone:'info',updated_at:'t9'}]};
      await page.reload();await page.waitForSelector('#announcement-banners');await page.screenshot({path:process.env.SHOT.replace('.png','-signin.png')});}
    assert.deepEqual(errors,[]);

    // ---------------- before the database side exists ----------------
    const early=await browser.newPage({viewport:{width:390,height:844}});
    await early.route('https://**',r=>{
      const u=r.request().url();
      if(u.includes('rt_announcements_live'))return r.fulfill({status:404,contentType:'application/json',body:'{"code":"PGRST202"}'});
      if(u.includes('rt_conference_public_days'))return r.fulfill({contentType:'application/json',body:JSON.stringify([{id:'d1',day:inDays(2),title:'x',windows:[]}])});
      return r.abort();
    });
    await early.goto(BASE+'/');await early.waitForSelector('#announcement-banners');
    // 6. The conference banner still comes through.
    assert((await early.innerText('#announcement-banners')).includes('Parent-teacher conferences are this week'));
    await early.close();

    // ---------------- the admin editor ----------------
    const admin=await browser.newPage({viewport:{width:1200,height:900}});
    const aerr=[];admin.on('pageerror',e=>aerr.push(e.message));
    await admin.route('https://**',r=>r.abort());
    await admin.goto(BASE+'/portal/index.html');
    await admin.waitForFunction(()=>window.app?.auth);
    await admin.evaluate(`window.makeDb=${pagesDatabase.toString()}`);
    const past=new Date(Date.now()-86400000).toISOString(), longAgo=new Date(Date.now()-3*86400000).toISOString();
    await admin.evaluate(([past,longAgo])=>{
      const a=window.app;
      window.db=window.makeDb({announcements:[
        {id:'old',message:'Last week’s fundraiser',link_url:null,link_label:null,tone:'info',audiences:['parents'],starts_at:longAgo,ends_at:past,updated_at:longAgo,created_at:longAgo}]},{});
      a.auth.supabase=window.db;a.supabaseQuery=fn=>fn();a.hideLoading=()=>{};
      a.userInfo={profile:{id:'admin',user_type:'admin'}};
      window.messages=[];a.showNotification=(message,type)=>window.messages.push({message,type});
      window.confirm=()=>true;
    },[past,longAgo]);
    await admin.evaluate(()=>app.openAnnouncementsAdmin());
    await admin.waitForSelector('#ann-message');
    const body=()=>admin.innerText('#ann-admin-body');
    // 7. The ended one is listed as ended.
    assert((await body()).includes('Ended'),'ended one listed');
    // 8. Post one now, parents and students only, with a link.
    await admin.fill('#ann-message','No school Friday: teacher in-service.');
    await admin.fill('#ann-link-url','/calendar/');await admin.fill('#ann-link-label','Calendar');
    await admin.uncheck('.ann-aud[value="visitors"]');await admin.uncheck('.ann-aud[value="staff"]');
    await admin.click('button:has-text("Post announcement")');
    await admin.waitForFunction(()=>window.messages.at(-1).message==='Announcement posted');
    let rows=await admin.evaluate(()=>db.tables.announcements);
    const posted=rows.find(r=>r.message.startsWith('No school'));
    assert.deepEqual(posted.audiences,['parents','students']);
    assert.equal(posted.link_url,'/calendar/');assert.equal(posted.ends_at,null);
    assert((await body()).includes('● Live'));
    // 9. Schedule one for next week, ending two days later: listed as scheduled.
    await admin.fill('#ann-message','Conferences next week - book a time.');
    const local=(ms)=>{const d=new Date(ms);const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;};
    await admin.fill('#ann-starts',local(Date.now()+7*86400000));
    await admin.fill('#ann-ends',local(Date.now()+9*86400000));
    await admin.check('#ann-important');
    await admin.click('button:has-text("Post announcement")');
    await admin.waitForFunction(()=>window.messages.at(-1).message.startsWith('Scheduled for'));
    assert((await body()).includes('◷ Scheduled'));
    rows=await admin.evaluate(()=>db.tables.announcements);
    const sched=rows.find(r=>r.message.startsWith('Conferences next week'));
    assert.equal(sched.tone,'important');
    assert(new Date(sched.ends_at)-new Date(sched.starts_at)>1.9*86400000);
    // 10. Bad input says what is wrong and writes nothing.
    const before=rows.length;
    await admin.fill('#ann-message','x');await admin.fill('#ann-link-url','javascript:alert(1)');
    await admin.click('button:has-text("Post announcement")');
    assert.match((await admin.evaluate(()=>window.messages.at(-1).message)),/https:\/\//);
    assert.equal((await admin.evaluate(()=>db.tables.announcements)).length,before);
    // 11. Edit the live one: the form fills, the change saves.
    await admin.click(`.ann-row[data-id="${posted.id}"] button:has-text("Edit")`);
    assert.equal(await admin.inputValue('#ann-message'),'No school Friday: teacher in-service.');
    assert.equal(await admin.isChecked('.ann-aud[value="visitors"]'),false,'its audiences, not the defaults');
    await admin.fill('#ann-message','No school Friday or Monday: teacher in-service.');
    await admin.click('button:has-text("Save changes")');
    await admin.waitForFunction(()=>window.messages.at(-1).message==='Announcement updated');
    assert((await admin.evaluate(()=>db.tables.announcements)).some(r=>r.message==='No school Friday or Monday: teacher in-service.'));
    // 12. Cancel the scheduled one: it is over without ever showing.
    await admin.click(`.ann-row[data-id="${sched.id}"] button:has-text("Cancel it")`);
    await admin.waitForFunction(()=>window.messages.at(-1).message==='Announcement ended');
    const s2=(await admin.evaluate(()=>db.tables.announcements)).find(r=>r.id===sched.id);
    assert(new Date(s2.ends_at)<=new Date() && new Date(s2.starts_at)<new Date(s2.ends_at));
    // 13. Delete.
    await admin.click(`.ann-row[data-id="old"] button:has-text("Delete")`);
    await admin.waitForFunction(()=>window.messages.at(-1).message==='Announcement deleted');
    assert(!(await admin.evaluate(()=>db.tables.announcements)).some(r=>r.id==='old'));
    if(process.env.SHOT)await admin.screenshot({path:process.env.SHOT.replace('.png','-admin.png'),fullPage:true});
    // 14. A non-admin is told, not shown the editor.
    await admin.evaluate(()=>{app.closeModal?.('announcements');app.userInfo={profile:{id:'t',user_type:'teacher'}};});
    await admin.evaluate(()=>app.openAnnouncementsAdmin());
    assert.equal(await admin.evaluate(()=>window.messages.at(-1).message),'Announcements are set by an admin');
    assert.deepEqual(aerr,[]);
    console.log('Announcements: 14 journeys passed (sign-in page on a phone, before the database, admin editor).');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
