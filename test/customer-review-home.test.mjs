import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initialiseHomePage } from '../src/app.js';
import { connectSupabaseCustomerMissions } from '../src/customer/supabase-mission.js';

const settle=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
function backend(){
  const mission={id:'m1',providerId:'p1',status:'completed',version:7,paymentStatus:'paid_external',serviceCategory:'electricity',problemDescription:'Synthetic',address:'Test',completedAt:'2026-09-13T04:00:00Z',requestedAt:'2026-09-13T03:00:00Z',finalAuthorizedAmount:625000,currency:'VND'};
  let review=null,writes=0,unsubscribed=0;
  const repository={getActiveCurrent:async()=>null,getLatestCompletedAwaitingReview:async()=>review?null:mission,getById:async()=>mission,getQuoteHistory:async()=>[],getReview:async()=>review,getInvoice:async()=>({id:'invoice1',totalAmount:625000,currency:'VND'}),getCurrentUserHistory:async()=>[{...mission,review}],subscribeMission:()=>()=>{unsubscribed++;},createReview:async(_id,rating,comment)=>{writes++;review={rating,comment};}};
  const connector=options=>connectSupabaseCustomerMissions({...options,runtimeConfig:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public-test-key'},repositoryLoader:async()=>({missions:repository,providers:{getProfessionalProfile:async()=>({id:'p1',name:'Synthetic Provider',rating:5,reviewCount:1})},profiles:{getCurrentUserId:async()=> 'customer'}})});
  return{connector,get review(){return review;},get writes(){return writes;},get unsubscribed(){return unsubscribed;}};
}
async function application(backend){
  const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'});const root=dom.window.document.querySelector('#root');const tasks=[];
  initialiseHomePage(root,undefined,undefined,undefined,fn=>{tasks.push(fn);return tasks.length;},undefined,()=>({setClientLocation(){},async render(){}}),undefined,undefined,undefined,backend.connector,{resume:async()=>({authenticated:true,session:{user:{id:'customer'}}})});
  await tasks[0]();await settle();return{root,dom,tasks};
}
async function evaluate(app){
  app.root.querySelector('[data-rating="5"]').click();await settle();
  app.root.querySelector('[data-review-comment]').value='Synthetic feedback';
  app.root.querySelector('[data-send-review]').click();await settle();
  assert.match(app.root.querySelector('.review-thanks').textContent,/Cảm ơn bạn đã đánh giá/);
}
function assertHome(root){
  assert.equal(root.querySelector('[data-app-view="home"]').hidden,false);
  for(const selector of ['#home-title','#service-request','.services','[data-new-request-flow]'])assert.equal(root.querySelector(selector).closest('[hidden]'),null,selector);
  assert.equal(root.querySelector('[data-mission-tracker]').hidden,true);
  assert.equal(root.querySelector('.review-thanks'),null);
}
test('review -> home restores complete intake, preserves review/history, ignores old poll and stays home on reload',async()=>{
  const data=backend();const app=await application(data);let reloaded;
  try{
    await evaluate(app);const savedReview={...data.review};
    app.root.querySelector('[name="address"]').value='Preserved address';
    app.root.querySelector('[data-review-home]').click();await settle();assertHome(app.root);
    assert.equal(data.unsubscribed,1);assert.equal(data.writes,1);assert.deepEqual(data.review,savedReview);
    assert.equal(app.root.querySelector('[name="address"]').value,'Preserved address');
    await app.tasks.at(-1)();await settle();assertHome(app.root);
    app.root.querySelector('[data-navigation="history"]').click();await settle();
    const history=app.root.querySelector('[data-app-view="history"]');assert.equal(history.hidden,false);assert.match(history.textContent,/✓ Đã đánh giá/);assert.match(history.textContent,/Synthetic Provider/);
    assert.equal(data.writes,1);assert.deepEqual(data.review,savedReview);
    reloaded=await application(data);assertHome(reloaded.root);assert.deepEqual(data.review,savedReview);
  }finally{app.dom.window.close();reloaded?.dom.window.close();}
});
test('review thank-you history button continues opening real reviewed history',async()=>{
  const data=backend();const app=await application(data);
  try{await evaluate(app);app.root.querySelector('[data-review-history]').click();await settle();const history=app.root.querySelector('[data-app-view="history"]');assert.equal(history.hidden,false);assert.match(history.textContent,/✓ Đã đánh giá/);assert.equal(data.writes,1);}
  finally{app.dom.window.close();}
});
