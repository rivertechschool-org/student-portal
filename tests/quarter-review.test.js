const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { reviewWindow, quarterLabel, render, mount } = require('../shared/quarter-review');
const quarters = [
  { id: 'q1', name: 'Quarter 1', start_date: '2026-08-01' },
  { id: 'q2', name: 'Quarter 2', start_date: '2026-10-01', is_current: true },
  { id: 'q3', name: 'Quarter 3', start_date: '2027-01-01' },
];
const transition = { previous_quarter_id: 'q1', current_quarter_id: 'q2', switched_at: '2026-11-02T17:00:00Z' };
assert.equal(reviewWindow(quarters, transition, new Date('2026-11-02T16:59:59Z')), null);
const review = reviewWindow(quarters, transition, new Date('2026-11-02T17:00:00Z'));
assert.equal(review.quarter.id, 'q1');
assert.ok(reviewWindow(quarters, transition, new Date('2026-11-23T16:59:59Z')));
assert.equal(reviewWindow(quarters, transition, new Date('2026-11-23T17:00:00Z')), null);
assert.equal(reviewWindow(quarters, null, new Date('2026-10-22T00:00:00')), null);
assert.equal(reviewWindow(quarters, null, new Date('2026-10-02T00:00:00')).quarter.id, 'q1');
for (let n = 1; n <= 4; n++) assert.equal(quarterLabel(`Quarter ${n}`), `${['','1st','2nd','3rd','4th'][n]} Quarter`);
const q3 = quarters.map(q => ({...q, is_current: q.id === 'q3'}));
assert.equal(reviewWindow(q3, {current_quarter_id:'q3',previous_quarter_id:'q2',switched_at:'2027-01-05T00:00:00Z'}, new Date('2027-01-06')).quarter.id, 'q2');
const people = [{id:'child-a',name:'Sample <A>'}, {id:'child-b',name:'Sample B'}];
const rows = Array.from({length:5}, (_,i)=>({class_grade:80+i, class_enrollments:{student_id:'child-a',class_id:`class-${i}`,classes:{name:`Class ${i}`}}}));
rows.push({class_grade:95,class_enrollments:{student_id:'child-b',class_id:'other',classes:{name:'Other child class'}}});
rows.push({class_grade:null,class_enrollments:{student_id:'child-a',class_id:'ungraded',classes:{name:'Not graded'}}});
let output=render(review,people,rows);
assert.match(output,/1st Quarter is over! Take a look at your grades\./);
assert.equal((output.match(/View assignments/g)||[]).length,4);
assert.match(output,/View all classes/);
assert.match(output,/Sample &lt;A&gt;/);
assert.match(output,/student=child-a/); assert.match(output,/student=child-b/);
assert.doesNotMatch(output,/Not graded/);
output=render(review,people,rows,true);
assert.equal((output.match(/View assignments/g)||[]).length,6);
assert.match(output,/quarter=q1/);
assert.equal(render(review,people,[]),'');

// Real loaders and queries, with synthetic student/parent data.
(async()=>{
  const originalTimeout = global.setTimeout;
  global.setTimeout = ()=>0;
  try {
    for (const role of ['student','parent']) {
      const calls=[];
      const now = new Date();
      const q = [{id:'old',name:'Quarter 1',start_date:'2020-01-01'}, {id:'new',name:'Quarter 2',start_date:'2020-04-01',is_current:true}];
      const data = {
        quarters:q, school_settings:{value:JSON.stringify({previous_quarter_id:'old',current_quarter_id:'new',switched_at:now.toISOString()})},
        parent_child_links:[{child_id:'child-a'},{child_id:'child-b'}],
        user_profiles:[{id:'child-a',first_name:'Sample',last_name:'A'},{id:'child-b',first_name:'Sample',last_name:'B'}],
        quarter_grade_snapshots:rows,
      };
      const sb={from(table){const query={then(resolve){resolve({data:data[table],error:null})}};
        for(const method of ['select','eq','in','order','range','maybeSingle']) query[method]=(...args)=>{calls.push([table,method,...args]);return query};
        return query;
      }};
      const auth={getUserInfo:()=>({profile:{user_type:role},user:{id:'parent-auth'}}),studentRecordId:()=> 'child-a',supabase:sb};
      const el={isConnected:true,hidden:true,innerHTML:''};
      await mount(auth,el);
      assert.equal(el.hidden,false);
      assert.match(el.innerHTML,/80.0%/);
      const filter=calls.find(c=>c[0]==='quarter_grade_snapshots'&&c[1]==='in');
      assert.deepEqual(filter[3],role==='student'?['child-a']:['child-a','child-b']);
      if(role==='parent') assert.ok(calls.some(c=>c[0]==='parent_child_links'&&c[2]==='parent_id'&&c[3]==='parent-auth'));
      el.onclick({target:{closest:()=>true}});
      assert.match(el.innerHTML,/Show fewer classes/);
    }
  } finally {global.setTimeout=originalTimeout}
  // All inline scripts still compile after the deep link and modal changes.
  for(const file of ['index.html','portal/index.html']) {
    const html=fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8');
    for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if(!/src=|type="(?:application|module)/.test(match[1])) new vm.Script(match[2]);
    }
  }
  console.log('Quarter review: date boundaries, recurring quarters, parent separation, grade preview, loaders and scripts passed');
})().catch(e=>{console.error(e);process.exitCode=1});

// Historical links keep the class, quarter and child together.
function portalMethod(name) {
  const html=fs.readFileSync(require('node:path').join(__dirname,'../portal/index.html'),'utf8');
  const start=html.search(new RegExp('\\n      (async )?'+name+'\\('));
  const end=html.indexOf('\n      }\n',start);
  return eval('('+html.slice(start,end+9).trim().replace(/^(async )?\w+\(/,(_,a)=>(a||'')+'function(')+')');
}
const route=portalMethod('handlePortalDeepLink');
const ids={cls:'aaaaaaaa-1111-1111-1111-111111111111',quarter:'bbbbbbbb-1111-1111-1111-111111111111',child:'cccccccc-1111-1111-1111-111111111111'};
global.window={location:{href:'https://example.test/portal/'},history:{replaceState(){}}};
for(const role of ['student','parent']) {
 const opened=[];
 const result=route.call({userInfo:{profile:{user_type:role}},viewQuarterAssignments:(...args)=>opened.push(args)},`?go=quarter-assignments&class=${ids.cls}&quarter=${ids.quarter}&student=${ids.child}`);
 assert.equal(result,'quarter-assignments');
 assert.deepEqual(opened,[[ids.quarter,ids.cls,ids.child]]);
}
assert.equal(portalMethod('_dayAfterDateOnly')('2026-10-31'),'2026-11-01');
delete global.window;
