const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync(require('node:path').join(__dirname,'../portal/index.html'), 'utf8');
function method(name) {
  const start = html.search(new RegExp('\\n      (async )?' + name + '\\('));
  const end = html.indexOf('\n      }\n', start);
  return eval('(' + html.slice(start, end + 9).trim().replace(/^(async )?\w+\(/, (_, a) => (a || '') + 'function(') + ')');
}
const inactive = method('isInactiveMessageRecipient');
assert.equal(inactive({user_type:'teacher',account_status:'inactive'}),true);
assert.equal(inactive({type:'Teacher',account_status:'inactive'}),true);
assert.equal(inactive({user_type:'admin',account_status:'inactive'}),true);
for (const profile of [{user_type:'teacher',account_status:'activated'}, {user_type:'teacher'}, {user_type:'student',account_status:'inactive'}, {user_type:'parent',account_status:'inactive'}]) assert.equal(inactive(profile),false);
const id = 'aaaaaaaa-1111-1111-1111-111111111111';
(async()=>{
  // Reject unknown recipients and resolve both profile IDs and auth IDs.
  const calls=[];
  const app={supabaseQuery:fn=>fn(),auth:{supabase:{from(table){
    const q={then(resolve){resolve({data:{id,user_type:'teacher',account_status:'inactive'},error:null})}};
    for(const key of ['select','or','limit','maybeSingle']) q[key]=(...args)=>{calls.push([key,...args]);return q};
    return q;
  }}},isInactiveMessageRecipient:inactive,loadMessageRecipientProfile:method('loadMessageRecipientProfile')};
  await assert.rejects(()=>app.loadMessageRecipientProfile('bad-input'),/valid recipient/);
  await assert.rejects(()=>method('requireActiveMessageRecipient').call(app,id),/no longer active/);
  assert.ok(calls.some(c=>c[0]==='or'&&c[1]===`id.eq.${id},auth_user_id.eq.${id}`));
  // All sender roles are blocked before any database write or notification.
  global.document={getElementById:key=>key==='conversation-reply-form'?null:({value:key==='message-recipient'?id:'Synthetic message'})};
  global.window={PortalUI:{showNotification(){}}};
  const oldError=console.error; console.error=()=>{};
  try {
    for(const role of ['student','parent','teacher','admin']) {
      for(const name of ['sendMessage','sendMessageInThread']) {
        let writes = 0;
        const writer={...app,userInfo:{profile:{user_type:role}},
          requireActiveMessageRecipient:method('requireActiveMessageRecipient'),showNotification(){},
          supabaseQuery(){writes++;throw new Error('Must not write a message');}};
        // Use the real lookup with its own synthetic read query.
        writer.loadMessageRecipientProfile=app.loadMessageRecipientProfile.bind(app);
        await method(name).call(writer,id);
        assert.equal(writes, 0, `${role}: ${name} must stop before inserting`);
      }
    }
  } finally {console.error=oldError}
  // Recipient lists use the same check for every role; PIN students remain.
  for(const role of ['student','parent','teacher','admin']) {
    const profiles=[{id:'active',user_type:'teacher',first_name:'Active',last_name:'Teacher',account_status:'activated'},
      {id:'former',user_type:'teacher',first_name:'Former',last_name:'Teacher',account_status:'inactive'}];
    const fake={userInfo:{user:{id:'me'},profile:{user_type:role}},classes:[{id:'class',teacher_id:'former'}],
      children:[{classes:[{teacher_id:'former'}]}],isInactiveMessageRecipient:inactive,
      supabaseQuery:fn=>fn(),fetchAllRows:()=>[],updateMessageRecipientsDropdown(){},
      auth:{supabase:{from(table){const q={then(resolve){resolve({data:table==='class_enrollments'?[]:profiles,error:null})}};
        for(const key of ['select','eq','in','neq','or','range'])q[key]=()=>q;return q;}}}};
    await method('loadMessageRecipients').call(fake);
    assert.ok(fake.messageRecipients.some(p=>p.id==='active'));
    assert.ok(!fake.messageRecipients.some(p=>p.id==='former'));
  }
  // Old conversation history is visible, without a reply composer for former staff.
  let rendered='';
  const timer=global.setTimeout; global.setTimeout=()=>0;
  try {
    method('showConversationModal').call({isInactiveMessageRecipient:inactive,showModal:(id,title,body)=>rendered=body},
      {profile:{id,user_type:'teacher',account_status:'inactive',first_name:'Sample',last_name:'Teacher'},messages:[]});
    assert.match(rendered,/conversation history/);
    assert.doesNotMatch(rendered,/<form id="conversation-reply-form"/);
  } finally {global.setTimeout=timer}
  delete global.document;delete global.window;
  console.log('Inactive message recipients: all roles, lists, both send paths, split IDs and history passed');
})().catch(e=>{console.error(e);process.exitCode=1});
