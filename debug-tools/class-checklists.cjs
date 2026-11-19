// Run: python -m http.server 8780, then node debug-tools/class-checklists.cjs
// A teacher adds a checklist to their class notes, ticks one item, ticks
// them all, unticks them all; then in a class sheet adds checkboxes down a
// column, ticks with a click and with Space, ticks and clears the whole
// column, and counts the ticks with a formula (2026-11-19). Supabase is a
// small in-memory stub; all external requests are blocked.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PAGES_CHROME?{executablePath:process.env.PAGES_CHROME}:{}),args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',d=>d.dismiss());
    await page.route('https://**',r=>r.abort());
    await page.goto(process.env.PORTAL_URL || 'http://localhost:8780/portal/index.html');
    await page.waitForFunction(()=>window.app?.auth);
    await page.evaluate(()=>{
      const a=window.app;
      window.T={notes:[],teacher_sheets:[{id:'s1',user_id:'t',class_id:'c1',name:'Homework',csv_data:['Name,Handed in,','Ada,,','Bo,,','Cy,,',',,'].join('\n')}]};
      window.updates=[];
      // Just enough of a query builder: filters by eq, returns copies.
      const q=(table)=>{let rows=()=>window.T[table];const f=[];let one=false,op=null,val=null;
        const b={select(){return b;},order(){return b;},is(k,v){f.push(r=>r[k]==v);return b;},eq(k,v){f.push(r=>r[k]===v);return b;},
          single(){one=true;return b;},
          insert(v){op='insert';val={id:'n'+(window.T[table].length+1),created_at:new Date().toISOString(),updated_at:null,note_date:'2026-11-19',...v};return b;},
          update(v){op='update';val=v;return b;},
          then(ok,bad){let out;
            if(op==='insert'){window.T[table].push(val);out=one?{...val}:[{...val}];}
            else{const hit=rows().filter(r=>f.every(g=>g(r)));
              if(op==='update'){hit.forEach(r=>Object.assign(r,val));window.updates.push({table,val});}
              out=one?(hit[0]?{...hit[0]}:null):hit.map(r=>({...r}));}
            return Promise.resolve({data:out,error:null}).then(ok,bad);}};return b;};
      a.auth.supabase={from:q};a.supabaseQuery=fn=>fn();
      a.auth.initialized=true;a.userInfo={profile:{id:'t',user_type:'teacher'},user:{id:'t'}};
      a.classes=[{id:'c1',name:'Invented Class'}];
      window.messages=[];a.showNotification=(m,t)=>window.messages.push({m,t});
    });

    // ---- Notes: a checklist ----
    await page.evaluate(()=>app.showClassNotes('c1'));
    await page.waitForSelector('#class-note-input');
    await page.click('.class-note-mode[data-mode="checklist"]');
    assert.match(await page.getAttribute('#class-note-input','placeholder'),/One item per line/);
    await page.fill('#class-note-input','Grade quizzes\nEmail Ms Hale\nPrint maps');
    await page.click('text=Add Note');
    await page.waitForSelector('.class-note-check');
    const stored=()=>page.evaluate(()=>window.T.notes[0].note);
    assert.equal(await stored(),'- [ ] Grade quizzes\n- [ ] Email Ms Hale\n- [ ] Print maps','saved as checklist lines');
    const body=()=>page.innerText('[id^="class-note-body-"]');
    assert.match(await body(),/0\/3 done/);
    assert.equal(await page.locator('.class-note-check input').count(),3,'three boxes');
    // Tick one.
    await page.locator('.class-note-check input').nth(1).check();
    await page.waitForFunction(()=>window.T.notes[0].note.includes('- [x] Email'));
    assert.match(await body(),/1\/3 done/);
    assert.equal(await page.evaluate(()=>window.T.notes[0].updated_at),null,'a tick is not an edit');
    // Tick all, then untick all - one button that flips.
    await page.click('text=Tick all');
    await page.waitForFunction(()=>!window.T.notes[0].note.includes('[ ]'));
    assert.match(await body(),/3\/3 done/);
    assert.match(await body(),/Untick all/);
    await page.click('text=Untick all');
    await page.waitForFunction(()=>!window.T.notes[0].note.includes('[x]'));
    assert.match(await body(),/0\/3 done/);
    // A plain note is still a plain note.
    await page.click('.class-note-mode[data-mode="note"]');
    await page.fill('#class-note-input','Fire drill moved to Tuesday');
    await page.click('text=Add Note');
    await page.waitForFunction(()=>window.T.notes.length===2);
    await page.waitForSelector('text=Fire drill moved to Tuesday');
    assert.equal(await page.evaluate(()=>window.T.notes[1].note),'Fire drill moved to Tuesday');
    // Edit offers the conversion.
    await page.evaluate(()=>app.editClassNote('n2','c1'));
    await page.waitForSelector('#edit-class-note-input');
    await page.click('text=Make every line a checklist item');
    assert.equal(await page.inputValue('#edit-class-note-input'),'- [ ] Fire drill moved to Tuesday');
    await page.evaluate(()=>app.closeModal('class-notes'));

    // ---- Sheets: checkboxes ----
    await page.evaluate(()=>app.showClassSheets('c1'));
    await page.evaluate(()=>app.openSheet('s1'));
    await page.waitForSelector('.sheet-cell');
    const at=(r,c)=>page.locator(`.sheet-cell[data-r="${r}"][data-c="${c}"]`);
    const raw=(r,c)=>page.evaluate(([r,c])=>app._sheetData[r][c],[r,c]);
    await at(1,1).click();
    await page.click('text=☑ Checkbox');
    await page.click('text=Checkboxes down column B');
    assert.equal(await page.locator('.sheet-check').count(),4,'boxes down the column, not on the heading');
    assert.equal(await raw(0,1),'Handed in');
    // Click ticks; Space ticks.
    await at(1,1).locator('.sheet-check').click();
    assert.equal(await raw(1,1),'[x]','a click ticks');
    assert.equal(await page.inputValue('#sheet-formula-bar'),'TRUE','the formula bar reads TRUE, as in Sheets');
    assert.equal(await at(1,1).locator('.sheet-check').isChecked(),true);
    await at(2,1).click();
    await page.keyboard.press(' ');
    assert.equal(await raw(2,1),'[x]','Space ticks');
    await page.keyboard.press(' ');
    assert.equal(await raw(2,1),'[ ]','and unticks');
    // Typing FALSE into a box keeps it a box.
    await at(1,1).click();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('FALSE');
    await page.keyboard.press('Enter');
    assert.equal(await raw(1,1),'[ ]','typed FALSE stays a box, unticked');
    await at(1,1).locator('.sheet-check').click();
    // A formula counts them.
    await at(0,2).click();
    await page.keyboard.type('=COUNTIF(B2:B5,TRUE)');
    await page.keyboard.press('Enter');
    assert.equal(await at(0,2).innerText(),'1');
    // Tick all, untick all in the column.
    await at(1,1).click();
    await page.click('text=☑ Checkbox');
    await page.click('text=Tick all in B');
    assert.deepEqual(await page.evaluate(()=>app._sheetData.slice(1).map(r=>r[1])),['[x]','[x]','[x]','[x]']);
    assert.equal(await at(0,2).innerText(),'4');
    await page.click('text=☑ Checkbox');
    await page.click('text=Untick all in B');
    assert.equal(await at(0,2).innerText(),'0');
    // Undo brings the ticks back.
    await page.keyboard.press('Control+z');
    assert.equal(await at(0,2).innerText(),'4','undo');
    // Saved as [x]/[ ]; exported as TRUE/FALSE.
    await page.waitForFunction(()=>window.T.teacher_sheets[0].csv_data.includes('Ada,[x]'),null,{timeout:4000});
    const exported=await page.evaluate(()=>{let out;app.downloadCSV=(csv)=>{out=csv;};app.exportCurrentSheetCSV();return out;});
    assert(exported.includes('Ada,TRUE'),exported);

    assert.deepEqual(errors,[]);
    console.log('Class checklists: notes (add, tick, tick all, untick all, plain note, convert) and sheet checkboxes (column, click, Space, COUNTIF, tick/untick all, undo, export) - all passed.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
