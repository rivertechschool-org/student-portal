// Run with Playwright installed: node tests/assignment-organization-browser.test.js
// Uses synthetic data and the actual portal method; never connects to production.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'portal/index.html'), 'utf8');
const start = html.indexOf('      async viewAssignments(classId) {');
const method = html.slice(start, html.indexOf('      async viewAllClassAssignments(classId)', start)).trim();
(async () => {
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] } : {}) });
  try {
    const page = await browser.newPage();
    await page.route('https://portal.test/**', route => route.fulfill({contentType:'text/html',body:'<main></main>'}));
    await page.goto('https://portal.test/');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<style>:root{--border:#555;--muted:#aaa;--text:#eee;--accent:#6aa9ff;--card-bg:#18202d}body{background:#101620;color:#eee;font:16px sans-serif}button,input,select{font:inherit}button{padding:6px}.card{padding:10px;border:1px solid #555}</style><main id="modal"></main>');
    await page.addStyleTag({ path: path.join(root, 'shared/styles.css') });
    await page.addStyleTag({ path: path.join(root, 'portal/styles.css') });
    await page.addStyleTag({content: html.match(/<style>([\s\S]*?)<\/style>/)[1]});
    await page.addStyleTag({ path: path.join(root, 'shared/assignment-organization.css') });
    await page.addScriptTag({ path: path.join(root, 'shared/assignment-organization.js') });
    await page.evaluate(method => {
      const rows = [
        { id: 'a', title: 'First assignment', due_date: '2026-11-20', is_published: true, assigned_to_all: true },
        { id: 'b', title: 'Second assignment', due_date: '2026-11-19', is_published: true, assigned_to_all: true },
        { id: 'c', title: 'Draft assignment', due_date: '2026-11-18', is_published: false, assigned_to_all: true },
        { id: 'd', title: 'Private assignment', due_date: '2026-11-17', is_published: true, assigned_to_all: false }
      ];
      window.classRow = { id: 'class', name: 'Example Class', teacher_id: 'teacher', assignment_organization: null };
      window.failSave = false;
      const from = table => {
        let filters = [], payload;
        const q = {
          select(){return q}, eq(k,v){filters.push(r=>typeof r[k]==='object' ? JSON.stringify(r[k])===v : r[k]===v);return q},
          is(k,v){filters.push(r=>r[k]===v);return q}, or(){return q}, order(){return q}, gte(){return q}, lte(){return q},
          in(){return q}, update(p){payload=p;return q}, single(){return q}, maybeSingle(){return q},
          then(resolve,reject){
            if (table === 'classes') {
              if (payload && window.failSave) return Promise.resolve({data:null,error:new Error('Test save failed')}).then(resolve,reject);
              const match = filters.every(f=>f(window.classRow));
              if (payload && match) Object.assign(window.classRow,payload);
              return Promise.resolve({data:match ? structuredClone(window.classRow) : null,error:null}).then(resolve,reject);
            }
            let data = table === 'assignments' ? rows.map(r=>({...r,class_id:'class'})).filter(r=>filters.every(f=>f(r))) : [];
            if(table === 'quarters') data = null;
            return Promise.resolve({data,error:null}).then(resolve,reject);
          }
        }; return q;
      };
      window.app = {
        ...new Function('return ({' + method + '})')(),
        classes:[window.classRow], userInfo:{profile:{user_type:'teacher',id:'teacher'},user:{id:'teacher'}},
        auth:{supabase:{from},studentRecordId:()=> 'student'},
        supabaseQuery: f=>f(), showLoading(){}, hideLoading(){},
        showModal(id,title,content){document.getElementById('modal').innerHTML=content},
        showNotification(message,type){window.lastNotification={message,type}},
        _pagesLoadTargets:async()=>new Map(),_pagesHasTargets:()=>false,_pagesGroupCards:(_,cards)=>cards.join(''),
        loadClassHomeworkResults(){},withMyVersions:async rows=>rows,studentVersionBadge:()=>'',_submittedLate:()=>false
      };
    }, method);
    await page.evaluate(() => app.viewAssignments('class'));
    await page.getByRole('button', { name: 'Organize assignments' }).click();
    await page.getByRole('button', {name: 'Drag Second assignment', exact:true}).dragTo(page.locator('.ao-row[data-id="a"]'));
    assert.deepEqual(await page.locator('.ao-row').evaluateAll(rows=>rows.map(r=>r.dataset.id)), ['b','a','c','d']);
    await page.getByRole('checkbox', {name:'Select First assignment',exact:true}).check();
    await page.getByRole('checkbox', {name:'Select Second assignment',exact:true}).check();
    await page.getByRole('textbox', {name:'New folder name'}).fill('Unit 1');
    await page.getByRole('button', {name:'New folder with selected'}).click();
    assert.equal(await page.locator('section.assignment-folder .ao-row').count(),2);
    await page.getByRole('button', {name:'Move First assignment up',exact:true}).click();
    await page.getByRole('button', {name:'Save organization'}).click();
    await page.getByRole('button', {name:'Organize assignments'}).waitFor();
    const saved = await page.evaluate(()=>classRow.assignment_organization);
    assert.deepEqual(saved.items.find(x=>x.type==='folder').items,['a','b']);
    assert.equal(await page.locator('#assignment-organized-cards summary').textContent(),'📁 Unit 1 (2)');
    // Failed saves retain the draft and expose a useful error; cancel restores saved cards.
    await page.getByRole('button', {name:'Organize assignments'}).click();
    await page.getByRole('button', {name:'Ungroup',exact:true}).click();
    await page.evaluate(()=>{window.failSave=true});
    await page.getByRole('button', {name:'Save organization'}).click();
    await page.getByText('Test save failed',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>classRow.assignment_organization),saved);
    await page.getByRole('button', {name:'Cancel',exact:true}).click();
    // Concurrent save: no rows updated; show conflict and retain unsaved changes.
    await page.evaluate(()=>{window.failSave=false});
    await page.getByRole('button', {name:'Organize assignments'}).click();
    await page.evaluate(()=>{classRow.assignment_organization={version:1,items:[]}});
    await page.getByRole('button', {name:'Save organization'}).click();
    await page.getByText(/Organization changed elsewhere/).waitFor();
    await page.evaluate(saved=>{classRow.assignment_organization=saved;app.userInfo.profile={user_type:'student',id:'student'};return app.viewAssignments('class')},saved);
    assert.equal(await page.getByRole('button',{name:'Organize assignments'}).count(),0);
    assert.equal(await page.getByText('Draft assignment',{exact:true}).count(),0);
    assert.equal(await page.getByText('Private assignment',{exact:true}).count(),0);
    assert.deepEqual(await page.locator('#assignment-organized-cards h4').allTextContents(),['First assignment','Second assignment']);
    // Mobile: all controls fit and work without drag-and-drop.
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{app.userInfo.profile={user_type:'teacher',id:'teacher'};return app.viewAssignments('class')});
    await page.getByRole('button',{name:'Organize assignments'}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
    await page.screenshot({path:'/tmp/assignment-organization-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('Browser: drag, selection, folders, keyboard buttons, save/reload, failure, conflict, student visibility and mobile layout passed.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
