// Run: python -m http.server 8780, then node debug-tools/class-sheets-keys.cjs
// A teacher's class sheet, driven with real key presses: it should behave
// like Google Sheets (2026-11-19). Typing replaces a cell (once - the first
// key used to appear twice), Tab moves right, Enter after Tabs goes back to
// the column the run started in, the edge of the grid grows, Escape abandons
// an edit, arrows commit a typed edit, a pasted block fills from the cell,
// and changes save themselves. Supabase is a small in-memory stub; all
// external requests are blocked.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PAGES_CHROME?{executablePath:process.env.PAGES_CHROME}:{}),args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://**',r=>r.abort());
    await page.goto(process.env.PORTAL_URL || 'http://localhost:8780/portal/index.html');
    await page.waitForFunction(()=>window.app?.auth);
    await page.evaluate(()=>{
      const a=window.app;
      // One sheet, 3 x 3, two filled cells. Every update is recorded.
      window.sheet={id:'s1',user_id:'t',class_id:'c1',name:'Seating',csv_data:'Name,Seat,\nAda,1,\n,,'};
      window.saves=[];
      const q=(rows)=>{const b={_r:rows,select(){return b;},eq(){return b;},order(){return b;},
        single(){return Promise.resolve({data:b._r[0],error:null});},
        update(v){window.saves.push(v);Object.assign(window.sheet,v);return b;},
        then(f,g){return Promise.resolve({data:b._r,error:null}).then(f,g);}};return b;};
      a.auth.supabase={from:()=>q([window.sheet])};a.supabaseQuery=fn=>fn();
      a.auth.initialized=true;a.userInfo={profile:{id:'t',user_type:'teacher'},user:{id:'t'}};
      a.classes=[{id:'c1',name:'Invented Class'}];
    });
    await page.evaluate(()=>app.showClassSheets('c1'));
    await page.evaluate(()=>app.openSheet('s1'));
    await page.waitForSelector('.sheet-cell');
    const cell=(r,c)=>page.evaluate(([r,c])=>app._sheetData[r][c],[r,c]);
    const sel=()=>page.evaluate(()=>[app._selectedCell.r,app._selectedCell.c]);
    const at=(r,c)=>page.locator(`.sheet-cell[data-r="${r}"][data-c="${c}"]`);

    // Typing replaces the cell, and the first key appears once.
    await at(2,0).click();
    await page.keyboard.type('Bo');
    await page.keyboard.press('Tab');
    assert.equal(await cell(2,0),'Bo','the first key is typed once');
    assert.deepEqual(await sel(),[2,1],'Tab moves right');
    await page.keyboard.type('2');
    await page.keyboard.press('Tab');
    assert.deepEqual(await sel(),[2,2]);
    await page.keyboard.type('front');
    await page.keyboard.press('Enter');
    assert.equal(await cell(2,2),'front');
    assert.deepEqual(await sel(),[3,0],'Enter after Tabs: back to where the Tabs began, a row down - and the grid grew a row');

    // Tab off the last column adds one.
    await at(0,2).click();
    await page.keyboard.press('Tab');
    assert.deepEqual(await sel(),[0,3],'Tab past the last column grows the grid');
    assert.equal(await page.evaluate(()=>app._sheetData[0].length),4);

    // Escape abandons an edit; Enter/F2 edit what is there.
    await at(1,0).click();
    await page.keyboard.type('Zed');
    await page.keyboard.press('Escape');
    assert.equal(await cell(1,0),'Ada','Escape keeps the old value');
    await page.keyboard.press('Enter');
    await page.keyboard.type(' L');
    await page.keyboard.press('Enter');
    assert.equal(await cell(1,0),'Ada L','Enter edits the existing text, caret at the end');
    assert.deepEqual(await sel(),[2,0],'and Enter commits and moves down');
    await page.keyboard.press('F2');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('x');
    await page.keyboard.press('Enter');
    assert.equal(await cell(2,0),'Bxo','in an F2 edit the arrows move the caret');

    // An edit started by typing: an arrow commits and moves.
    await at(0,1).click();
    await page.keyboard.type('Row');
    await page.keyboard.press('ArrowDown');
    assert.equal(await cell(0,1),'Row');
    assert.deepEqual(await sel(),[1,1],'arrow commits a typed edit and moves');

    // Delete clears; Ctrl+Z puts it back.
    await page.keyboard.press('Delete');
    assert.equal(await cell(1,1),'');
    await page.keyboard.press('Control+z');
    assert.equal(await cell(1,1),'1','undo');

    // Clicking another cell keeps what was typed.
    await at(3,1).click();
    await page.keyboard.type('kept');
    await at(3,2).click();
    assert.equal(await cell(3,1),'kept','clicking away keeps the edit');

    // A block pasted from Google Sheets (tabs and newlines) fills from the cell.
    await at(3,2).click();
    await page.evaluate(()=>{const dt=new DataTransfer();dt.setData('text/plain','a\tb\nc\td\n');
      document.getElementById('sheet-grid-wrapper').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));});
    assert.deepEqual(await page.evaluate(()=>[app._sheetData[3][2],app._sheetData[3][3],app._sheetData[4][2],app._sheetData[4][3]]),['a','b','c','d'],'paste fills a block and grows the grid');

    // One key press per key: no listener doubling after redraws.
    await at(0,0).click();
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await sel(),[0,1],'one arrow press moves one cell after the grid was redrawn');

    // It saves itself.
    await page.waitForFunction(()=>window.saves.length>0,null,{timeout:4000});
    const saved=await page.evaluate(()=>window.sheet.csv_data);
    assert(saved.startsWith('Name,Row,'),saved);
    assert(saved.includes('Ada L'),saved);
    assert.equal(await page.innerText('#sheet-status'),'All changes saved');

    // Leaving with a change waiting saves it.
    await at(0,0).click();
    await page.keyboard.type('Pupil');
    await page.keyboard.press('Enter');
    await page.evaluate(()=>app.closeModal('class-sheets'));
    await page.waitForFunction(()=>window.sheet.csv_data.startsWith('Pupil,'),null,{timeout:2000});

    assert.deepEqual(errors,[]);
    console.log('Class sheets: keys behave like Google Sheets (typing once, Tab/Enter, grow, Escape, F2, arrows, undo, paste, autosave) - all passed.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
