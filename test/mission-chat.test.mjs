import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createMissionChat, createMissionChatButton } from '../src/chat/mission-chat.js';
import { chatShortcuts, createMissionChatRepository } from '../src/chat/mission-chat-repository.js';
import { createSupabaseMissionsRepository } from '../src/supabase/repositories/missions.js';
import { createSupabaseOffersRepository } from '../src/supabase/repositories/offers.js';
import { createAssignedProviderCompactMarkup } from '../src/tracking/tracking-sheet.js';
import { renderActiveProviderMission } from '../src/provider/provider-app.js';
import { createProviderDispatchController } from '../src/provider/provider-dispatch.js';
import { createCustomerMissionSynchronizer } from '../src/customer/supabase-mission.js';

const mission={id:'59200000-0000-4000-8000-000000000010',status:'travelling'};
const user='59200000-0000-4000-8000-000000000001';
const row=(n,body='Xin chào',sender=user)=>({id:`59200000-0000-4000-8000-${String(n).padStart(12,'0')}`,mission_id:mission.id,sender_user_id:sender,body,created_at:'2026-09-13T08:00:00Z'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(role='provider') {
  const dom=new JSDOM('<body><main><button data-mission-chat-open>Nhắn tin <span data-chat-unread hidden></span></button></main></body>');
  const sent=[];let data=[];const manager=createMissionChat({documentRef:dom.window.document,userId:user,role,messages:{list:async()=>data,send:async(id,body)=>{sent.push({id,body});return row(sent.length,body);}}});
  manager.observe({mission,messages:[]});return {dom,manager,sent,setData:value=>{data=value;},doc:dom.window.document};
}
test('chat buttons only for accepted/active statuses, never before or terminal',()=>{
  for(const status of ['requested','searching','offered','completed','cancelled','expired'])assert.equal(createMissionChatButton({...mission,status}),'');
  for(const status of ['accepted','travelling','arrived','quote_pending','in_progress','supplement_pending','completed_pending_payment'])assert.match(createMissionChatButton({...mission,status}),/Nhắn tin/);
  assert.equal(createMissionChatButton(mission,false),'');
});
test('deterministic shortcuts by role and status, maximum three plus Khác',()=>{
  assert.deepEqual(chatShortcuts('provider','travelling'),['Tôi đang đi','Tôi sẽ đến trong 5 phút','Tôi sẽ đến trong 10 phút']);
  assert.deepEqual(chatShortcuts('customer','arrived'),['Tôi ra ngay','Vui lòng chờ 5 phút','Tôi đang xuống']);
  for(const role of ['provider','customer'])for(const status of ['accepted','travelling','arrived','quote_pending','in_progress','supplement_pending','completed_pending_payment'])assert.equal(chatShortcuts(role,status).length,3);
});
for(const role of ['customer','provider'])test(`${role} shortcut sends immediately without keyboard`,async()=>{
  const s=setup(role);s.manager.open();assert.equal(s.doc.querySelector('[data-chat-form]').hidden,true);
  const button=s.doc.querySelector('[data-chat-quick]');button.click();await tick();
  assert.deepEqual(s.sent,[{id:mission.id,body:button.textContent}]);assert.equal(s.doc.querySelectorAll('[data-message-id]').length,1);s.manager.dispose();
});
test('Khác reveals editor; text is escaped; no attachments/phone',async()=>{
  const s=setup();s.manager.open();s.doc.querySelector('[data-chat-other]').click();
  assert.equal(s.doc.querySelector('[data-chat-form]').hidden,false);const input=s.doc.querySelector('textarea');input.value='<img src=x onerror=alert(1)>';
  s.doc.querySelector('form').dispatchEvent(new s.dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  assert.equal(s.doc.querySelector('[data-chat-thread] img'),null);assert.equal(s.doc.querySelector('li p').textContent,'<img src=x onerror=alert(1)>');assert.equal(input.value,'');s.manager.dispose();
});
test('500 characters accepted, 501 and blank refused before RPC',async()=>{
  const s=setup();s.manager.open();await s.manager.send('x'.repeat(500));await s.manager.send('x'.repeat(501));await s.manager.send('  ');
  assert.equal(s.sent.length,1);s.manager.dispose();
});
test('Realtime snapshots and polling deduplicate; preserve DOM, draft and focus',async()=>{
  const s=setup();s.manager.open();s.doc.querySelector('[data-chat-other]').click();const input=s.doc.querySelector('textarea');input.value='Đang viết';input.focus();
  const screen=s.doc.querySelector('.mission-chat');const remote=row(5,'Tôi ra ngay','peer');
  s.manager.observe({mission,messages:[remote]});s.manager.observe({mission,messages:[remote]});s.setData([remote]);await s.manager.refresh();
  assert.equal(s.doc.querySelector('.mission-chat'),screen);assert.equal(s.doc.querySelectorAll('li').length,1);assert.equal(input.value,'Đang viết');assert.equal(s.doc.activeElement,input);
  s.manager.observe({mission:{...mission,status:'arrived'},messages:[remote]});assert.equal(input.value,'Đang viết');assert.match(s.doc.querySelector('[data-chat-quick]').textContent,/Tôi đã đến/);s.manager.dispose();
});
test('closed chat badge increments only once for peer; opening clears',()=>{
  const s=setup();const remote=row(3,'Xin chào','peer');s.manager.observe({mission,messages:[remote]});s.manager.observe({mission,messages:[remote]});
  assert.equal(s.doc.querySelector('[data-chat-unread]').textContent,'1');s.manager.open();assert.equal(s.doc.querySelector('[data-chat-unread]').hidden,true);s.manager.dispose();
});
for(const status of ['completed','cancelled','expired'])test(`terminal ${status} closes and clears text immediately`,async()=>{
  const s=setup();s.manager.open();s.manager.observe({mission,messages:[row(3)]});s.manager.observe({mission:{...mission,status}});await s.manager.send('Should not send');
  assert.equal(s.doc.querySelector('.mission-chat'),null);assert.equal(s.sent.length,0);s.manager.observe({mission:{...mission,id:'59200000-0000-4000-8000-000000000011'}});s.manager.open();assert.equal(s.doc.querySelectorAll('li').length,0);s.manager.dispose();
});
test('late fetch after mission terminal never restores messages',async()=>{
  const dom=new JSDOM('<body/>');let resolve;const manager=createMissionChat({documentRef:dom.window.document,userId:user,role:'customer',messages:{list:()=>new Promise(r=>{resolve=r;}),send:async()=>row(2)}});
  manager.observe({mission});manager.open();manager.observe({mission:{...mission,status:'completed'}});resolve([row(2)]);await tick();assert.equal(dom.window.document.querySelector('li'),null);manager.dispose();
});
test('repository mutations only RPC, no sender chosen; errors propagate',async()=>{
  const calls=[];const repo=createMissionChatRepository({rpc:async(name,args)=>{calls.push({name,args});return {data:name==='get_mission_messages'?[]:row(1),error:null};}});
  await repo.list(mission.id);await repo.send(mission.id,'Xin chào');assert.deepEqual(calls[1],{name:'send_mission_message',args:{target_mission_id:mission.id,new_body:'Xin chào'}});
  await assert.rejects(()=>createMissionChatRepository({rpc:async()=>({error:{message:'denied'},data:null})}).list(mission.id));
});
test('migration hardens writes, validates 500, serializes terminal deletion and publishes Realtime',()=>{
  const sql=readFileSync('supabase/migrations/20260913090000_mission_messages.sql','utf8');assert.match(sql,/enable row level security/);assert.match(sql,/grant select/);assert.doesNotMatch(sql,/grant (insert|update|delete)/i);assert.match(sql,/for share/);assert.match(sql,/auth.uid\(\)/);assert.match(sql,/between 1 and 500/);assert.match(sql,/delete from public.mission_messages/);assert.match(sql,/alter publication supabase_realtime/);
  assert.doesNotMatch(readFileSync('src/chat/mission-chat.js','utf8'),/localStorage|sessionStorage|setInterval|\.channel\(|tel:|get_profile_phone|Stringee/);
});
test('existing Client and Provider Realtime channels include mission_messages without another channel',()=>{
  for(const role of ['customer','provider']) {
    let channelCount=0;const hooks=[];const channel={on(type,filter,handler){hooks.push({type,filter,handler});return this;},subscribe(){return this;}};
    const client={from(){},rpc(){},channel(){channelCount++;return channel;},removeChannel(){}};
    let notified=0;
    if(role==='customer')createSupabaseMissionsRepository(client).subscribeMission(mission.id,()=>{notified++;});
    else createSupabaseOffersRepository(client).subscribeProviderDispatch(user,mission.id,()=>{notified++;});
    const hook=hooks.find(x=>x.filter.table==='mission_messages');assert.ok(hook);assert.equal(hook.filter.event,'INSERT');
    assert.equal(hook.filter.filter,`mission_id=eq.${mission.id}`);
    hook.handler({new:row(1)});assert.equal(notified,1);assert.equal(channelCount,1);
  }
});
test('Client/Provider mission contact UI has chat beside existing VoIP without phone',()=>{
  const customer=createAssignedProviderCompactMarkup({name:'Test',category:'electricity',chatMission:mission,callMission:mission});
  assert.match(customer,/mission-contact-actions/);assert.match(customer,/data-mission-chat-open/);assert.match(customer,/data-mission-call-start/);assert.doesNotMatch(customer,/tel:|Số điện thoại/);
  const provider=renderActiveProviderMission(mission,{callsEnabled:true});assert.match(provider,/data-mission-chat-open/);assert.match(provider,/data-mission-call-start/);
  for(const status of ['offered','completed','cancelled'])assert.doesNotMatch(renderActiveProviderMission({...mission,status},{callsEnabled:true}),/data-mission-chat-open/);
});
test('Realtime message updates bypass Client business reload and Provider dashboard render',async()=>{
  let receive;let businessLoads=0;let deliveries=0;
  const synchronizer=createCustomerMissionSynchronizer({missionRepository:{getById(){businessLoads++;},subscribeMission(id,handler){receive=handler;return()=>{};}},providerRepository:{},missionMessages:{list:async()=>[row(1)]}});
  const stop=synchronizer.subscribe(mission.id,()=>assert.fail('No business render'),()=>assert.fail('No business error'),data=>{assert.equal(data.length,1);deliveries++;});
  await receive({table:'mission_messages',new:row(1)});assert.equal(businessLoads,0);assert.equal(deliveries,1);stop();
  let providerReceive;let providerLoads=0;let renders=0;let refreshes=0;
  const dispatch=createProviderDispatchController({repository:{source:'supabase',load:async()=>{providerLoads++;return{};},subscribeDispatch(handler){providerReceive=handler;return()=>{};}},getState:()=>({}),onState:()=>{renders++;},onMessageEvent:()=>{refreshes++;},scheduleTask:()=>undefined,clearTask:()=>{}});
  dispatch.start();providerReceive({table:'mission_messages',new:row(1)});await tick();assert.equal(providerLoads,0);assert.equal(renders,0);assert.equal(refreshes,1);dispatch.stop();
});
