import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createCallManager, createMissionCallButton, getGlobalCallManager } from '../src/calls/call-manager.js';
import { createAssignedProviderCompactMarkup } from '../src/tracking/tracking-sheet.js';
import { renderProviderDashboard } from '../src/provider/provider-app.js';
import { createProviderDispatchController } from '../src/provider/provider-dispatch.js';
import { createCallAudio } from '../src/calls/call-audio.js';

const flush = async () => { for (let index = 0; index < 12; index++) await new Promise(resolve => setImmediate(resolve)); };
const fixtures = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) { fixture.manager.dispose(); fixture.dom.window.close(); } });
function network({ringingMs=45000,streams=false}={}) {
  const clients = new Map(); let current = null; let sequence = 0; let connectionCount = 0;
  let missionStatus = 'accepted';
  const mission = () => ({id:'mission-test',status:missionStatus,serviceCategory:'electricity'});
  class Emitter { handlers = new Map(); on(key, callback) { this.handlers.set(key, callback); } emit(key, data) { this.handlers.get(key)?.(data); } }
  class Client extends Emitter {
    connect(identity) { this.identity=identity; clients.set(identity,this); connectionCount++; queueMicrotask(()=>this.emit('authen',{r:0})); }
    disconnect() { clients.delete(this.identity); this.emit('disconnect'); }
  }
  class Call extends Emitter {
    constructor(client,from,to,video) { super(); Object.assign(this,{client,from,to,video}); assert.equal(video,false); }
    makeCall(callback) {
      const peer = clients.get(this.to); if(!peer){callback({r:8});return;}
      this.other = new Call(peer,this.from,this.to,false); this.other.other=this;
      this.other.custom=this.custom; callback({r:0}); queueMicrotask(()=>{
        peer.emit('incomingcall',this.other);
        if(streams){const stream={getAudioTracks:()=>[{enabled:true}]};this.other.emit('addremotestream',stream);this.emit('addremotestream',stream);}
      });
    }
    answer(callback) { callback({r:0}); this.emit('signalingstate',{code:3}); this.other.emit('signalingstate',{code:3}); }
    reject(callback) { callback({r:0}); this.emit('signalingstate',{code:5}); this.other.emit('signalingstate',{code:5}); }
    hangup(callback) { callback({r:0}); this.emit('signalingstate',{code:6}); this.other?.emit('signalingstate',{code:6}); }
    mute(value) { this.muted=value; }
  }
  const identities = { customer:`ha_${'a'.repeat(28)}`,provider:`ha_${'b'.repeat(28)}` };
  const service = role => ({
    async start() {
      if(!['accepted','travelling','arrived','quote_pending','in_progress','supplement_pending','completed_pending_payment'].includes(missionStatus))throw new Error('Mission not callable');
      if(current && ['ringing','active'].includes(current.status))throw new Error('Double call refused');
      current={id:`call-${++sequence}`,mission_id:'mission-test',caller_user_id:role,callee_user_id:role==='customer'?'provider':'customer',room_name:`call_${String(sequence).padStart(32,'0')}`,status:'ringing',expires_at:new Date(Date.now()+ringingMs).toISOString()}; return {...current};
    },
    async current() { return current && ['ringing','active'].includes(current.status) ? {...current} : null; },
    async answer(id) { assert.equal(role,current.callee_user_id); assert.equal(id,current.id); current.status='active'; current.answered_at=new Date().toISOString(); return {...current}; },
    async decline(id) { assert.equal(role,current.callee_user_id); assert.equal(id,current.id); if(current.status==='ringing')current.status='declined'; return {...current}; },
    async end(id) { if(id===current?.id && ['ringing','active'].includes(current.status))current.status='ended'; return {...current}; },
  });
  const fixture = (role, options={}) => {
    const dom=new JSDOM('<main id="app"></main>',{url:'https://example.test/Home-ai/'});
    let ringCount=0;let clearCount=0;let microphoneCount=0;let attaches=0;let clock=Date.now();let interval;
    const audio={ activate:async()=>{},prepareMicrophone:async()=>{microphoneCount++;if(options.microphoneError)throw options.microphoneError;},ring:()=>{ringCount++;},stopRinging:()=>{},needsActivation:()=>false,attach:async()=>{attaches++;},clear:()=>{clearCount++;},dispose:()=>{} };
    const missionCalls=service(role);
    const tokens={issue:async id=>({accessToken:identities[role],userId:identities[role],expiresAt:2000000000,...(id?{peerUserId:identities[role==='customer'?'provider':'customer'],participantRole:current.caller_user_id===role?'caller':'callee'}:{})})};
    const manager=createCallManager({documentRef:dom.window.document,userId:role,role,missionCalls,tokens,sdkLoader:async()=>({StringeeClient:Client,StringeeCall:Call}),audio,now:()=>clock,scheduleInterval:callback=>{interval=callback;return 1;},clearIntervalTask:()=>{interval=null;}});
    const result={dom,manager,missionCalls,audio,observe:async()=>{manager.observe({mission:mission(),peer:{name:role==='provider'?'Synthetic Customer':'Synthetic Provider',avatarUrl:'https://example.test/avatar.png',phone:'PRIVATE',cccd:'PRIVATE'},currentCall:await missionCalls.current(),callLoaded:true});},tick:seconds=>{clock+=seconds*1000;interval?.();},getAttaches:()=>attaches,getMicrophoneCount:()=>microphoneCount,getClearCount:()=>clearCount,getRingCount:()=>ringCount};fixtures.push(result); return result;
  };
  return {fixture,mission,getCurrent:()=>current,getConnections:()=>connectionCount,disconnect:role=>clients.get(identities[role]).emit('disconnect'),terminal:status=>{missionStatus=status;if(current)current.status='ended';}};
}

describe('foreground Client/Provider calls',()=>{
  for(const caller of ['customer','provider'])it(`${caller} calls the other participant, answers, mutes and hangs up`,async()=>{
    const net=network(); const customer=net.fixture('customer');const provider=net.fixture('provider');
    await customer.observe();await provider.observe();await flush();
    const source=caller==='customer'?customer:provider; const target=caller==='customer'?provider:customer;
    await source.manager.start();await flush();
    assert.equal(net.getCurrent().status,'ringing'); assert.equal(target.manager.getState().phase,'incoming');
    assert.match(target.manager.host.textContent,caller==='customer'?/Khách hàng đang gọi/:/Thợ đang gọi/);
    assert.ok(target.manager.host.querySelector('img'));assert.match(target.manager.host.textContent,/Thợ điện/);
    await target.manager.action('answer');await flush();
    assert.equal(net.getCurrent().status,'active');assert.equal(source.manager.getState().phase,'active');assert.equal(target.manager.getState().phase,'active');
    assert.equal(target.getMicrophoneCount(),1);await source.manager.action('mute');assert.equal(source.manager.getState().muted,true);
    source.tick(65);assert.equal(source.manager.host.querySelector('[data-call-duration]').textContent,'01:05');
    await source.manager.action('end');await flush();assert.equal(net.getCurrent().status,'ended');assert.equal(target.manager.getState().phase,null);
  });
  it('callee hangup immediately closes both screens',async()=>{
    const net=network();const a=net.fixture('customer');const b=net.fixture('provider');await a.observe();await b.observe();await flush();await a.manager.start();await flush();await b.manager.action('answer');await b.manager.action('end');await flush();assert.equal(a.manager.getState().phase,null);assert.equal(net.getCurrent().status,'ended');
  });
  it('decline keeps declined and immediately permits a fresh call',async()=>{
    const net=network();const a=net.fixture('customer');const b=net.fixture('provider');await a.observe();await b.observe();await flush();await a.manager.start();await flush();const first=net.getCurrent().id;await b.manager.action('decline');await flush();assert.equal(net.getCurrent().status,'declined');assert.equal(a.manager.getState().phase,null);await a.manager.start();await flush();assert.notEqual(net.getCurrent().id,first);assert.equal(b.manager.getState().phase,'incoming');
  });
  it('backend missed closes the overlay and allows recall',async()=>{
    const net=network();const a=net.fixture('customer');const b=net.fixture('provider');await a.observe();await b.observe();await flush();await a.manager.start();await flush();net.getCurrent().status='missed';b.manager.observe({mission:net.mission(),currentCall:null,callLoaded:true,callEvent:{status:'missed'}});await flush();assert.equal(b.manager.getState().phase,null);assert.equal(net.getCurrent().status,'missed');await a.manager.start();await flush();assert.equal(net.getCurrent().status,'ringing');
  });
  it('repeated polling, Realtime and dashboard replacement retain one overlay/audio connection',async()=>{
    const net=network();const a=net.fixture('customer');const b=net.fixture('provider');await a.observe();await b.observe();await flush();await a.manager.start();await flush();const overlay=b.manager.host.firstElementChild;const button=overlay.querySelector('[data-call-action="answer"]');button.focus();
    for(let index=0;index<5;index++){b.dom.window.document.querySelector('#app').innerHTML='<p>Dashboard GPS tick</p>';await b.observe();}
    assert.equal(b.manager.host.firstElementChild,overlay);assert.equal(b.dom.window.document.activeElement,button);assert.equal(b.dom.window.document.querySelectorAll('.mission-call-screen').length,1);assert.equal(net.getConnections(),2);
  });
  it('one pending call forbids a second call from the other participant',async()=>{
    const net=network();const a=net.fixture('customer');const b=net.fixture('provider');await a.observe();await b.observe();await flush();await a.manager.start();await flush();const id=net.getCurrent().id;await b.manager.start();assert.equal(net.getCurrent().id,id);await assert.rejects(b.missionCalls.start('mission-test'),/Double call/);
  });
  it('preserves early SDK remote audio, waits for answer and never reattaches it on unchanged polling',async()=>{
    const net=network({streams:true});const a=net.fixture('customer');const b=net.fixture('provider');await a.observe();await b.observe();await flush();await a.manager.start();await flush();assert.equal(a.getAttaches(),0);assert.equal(b.getAttaches(),0);await b.manager.action('answer');await flush();assert.equal(a.getAttaches(),1);assert.equal(b.getAttaches(),1);for(let index=0;index<5;index++){await a.observe();await b.observe();}assert.equal(a.getAttaches(),1);assert.equal(b.getAttaches(),1);
  });
  for(const status of ['completed','cancelled','expired'])it(`${status} closes audio, disconnects and removes buttons`,async()=>{
    const net=network();const a=net.fixture('customer');const b=net.fixture('provider');await a.observe();await b.observe();await flush();await a.manager.start();await flush();await b.manager.action('answer');net.terminal(status);await a.observe();await b.observe();await flush();assert.equal(a.manager.getState().phase,null);assert.equal(b.manager.getState().phase,null);assert.equal(createMissionCallButton(net.mission(),'customer'),'');await a.manager.start();assert.equal(net.getCurrent().status,'ended');
  });
  it('microphone refusal is explicit and never creates a mission_call',async()=>{
    const net=network();const a=net.fixture('customer',{microphoneError:Object.assign(new Error('denied'),{name:'NotAllowedError'})});await a.observe();await flush();await a.manager.start();assert.equal(net.getCurrent(),null);assert.match(a.manager.host.textContent,/quyền sử dụng micro/);assert.doesNotMatch(a.manager.host.textContent,/denied|PRIVATE/);
  });
  it('Stringee connection loss stops media and permits retry',async()=>{
    const net=network();const a=net.fixture('customer');const b=net.fixture('provider');await a.observe();await b.observe();await flush();await a.manager.start();await flush();net.disconnect('customer');await flush();assert.equal(a.manager.getState().phase,null);assert.equal(net.getCurrent().status,'ended');assert.match(a.manager.host.textContent,/gián đoạn/);await a.manager.start();await flush();assert.equal(net.getCurrent().status,'ringing');
  });
  it('microphone denied while answering closes the existing call with an explicit error',async()=>{
    const net=network();const a=net.fixture('customer');const b=net.fixture('provider',{microphoneError:Object.assign(new Error('denied'),{name:'NotAllowedError'})});await a.observe();await b.observe();await flush();await a.manager.start();await flush();await b.manager.action('answer');await flush();assert.equal(net.getCurrent().status,'ended');assert.equal(a.manager.getState().phase,null);assert.match(b.manager.host.textContent,/quyền sử dụng micro/);
  });
  it('local ringing expiry does not change missed into ended',async()=>{
    const net=network({ringingMs:1000});const a=net.fixture('customer');const b=net.fixture('provider');await a.observe();await b.observe();await flush();await a.manager.start();await flush();await new Promise(resolve=>setTimeout(resolve,1100));a.tick(2);b.tick(2);await flush();assert.equal(a.manager.getState().phase,null);assert.equal(b.manager.getState().phase,null);assert.equal(net.getCurrent().status,'ringing');net.getCurrent().status='missed';assert.equal(net.getCurrent().status,'missed');
  });
  it('renders only permitted buttons and no phone/technical private data',()=>{
    for(const status of ['requested','searching','offered','completed','cancelled','expired'])assert.equal(createMissionCallButton({id:'m',status},'customer'),'');
    const profile=createAssignedProviderCompactMarkup({name:'Real Provider',category:'electricity',phone:'PRIVATE',callMission:{id:'m',status:'accepted'}});assert.match(profile,/Gọi cho thợ/);assert.doesNotMatch(profile,/PRIVATE|tel:|get_profile_phone|electricity/);
    const state={provider:{name:'Real Provider'},assignment:{id:'m',status:'accepted',serviceCategory:'electricity',request:'Test',address:'Test'},offers:[]};assert.match(renderProviderDashboard(state,{source:'supabase'}),/Gọi khách hàng/);assert.doesNotMatch(renderProviderDashboard(state,{source:'mock'}),/Gọi khách hàng/);
  });
  it('existing unchanged provider polling still supplies call snapshots without rendering dashboard',async()=>{
    const state={assignment:{id:'m',status:'accepted'},offers:[]};let renders=0;let refreshes=0;
    const controller=createProviderDispatchController({repository:{load:async()=>structuredClone(state)},getState:()=>state,onState:()=>renders++,onRefresh:()=>refreshes++});await controller.refresh();await controller.refresh();assert.equal(renders,0);assert.equal(refreshes,2);controller.stop();
  });
  it('global manager is reused across internal screen navigation',()=>{
    const dom=new JSDOM('<main></main>');const audio={clear(){},dispose(){},stopRinging(){},needsActivation:()=>true};const options={documentRef:dom.window.document,userId:'customer',role:'customer',missionCalls:{},tokens:{},audio};const manager=getGlobalCallManager(options);assert.equal(getGlobalCallManager(options),manager);assert.equal(dom.window.document.querySelectorAll('[data-mission-call-layer]').length,1);manager.dispose();dom.window.close();
  });
  it('full-screen layer has priority, safe areas, no fake speaker and reduced motion',async()=>{
    const css=await readFile(new URL('../src/calls/mission-call.css',import.meta.url),'utf8');assert.match(css,/position: fixed; inset: 0/);assert.match(css,/2147483647/);assert.match(css,/safe-area-inset/);assert.match(css,/prefers-reduced-motion/);
    const js=await readFile(new URL('../src/calls/call-manager.js',import.meta.url),'utf8');assert.doesNotMatch(js,/tel:|get_profile_phone|speaker|CCCD|STRINGEE_API_SECRET_KEY/);
  });
});

describe('Safari call audio activation',()=>{
  it('asks only for audio on tap, stops permission stream and keeps persistent remote element',async()=>{
    const dom=new JSDOM('<main></main>');let requested;let stopped=0;let played=0;
    class Context { state='suspended';resume(){this.state='running';return Promise.resolve();}close(){} }
    dom.window.HTMLMediaElement.prototype.pause=()=>{};dom.window.HTMLMediaElement.prototype.play=()=>{played++;return Promise.resolve();};
    const environment={AudioContext:Context,navigator:{mediaDevices:{getUserMedia:async options=>{requested=options;return {getTracks:()=>[{stop:()=>stopped++}]};}}},setInterval:()=>1,clearInterval:()=>{}};
    const audio=createCallAudio(dom.window.document,environment);assert.equal(audio.needsActivation(),true);await audio.prepareMicrophone();assert.deepEqual(requested,{audio:true,video:false});assert.equal(stopped,1);assert.equal(audio.needsActivation(),false);
    const element=dom.window.document.querySelector('[data-mission-call-audio]');dom.window.document.querySelector('main').innerHTML='New screen';assert.equal(dom.window.document.querySelector('[data-mission-call-audio]'),element);await audio.attach({getAudioTracks:()=>[]});assert.equal(played,1);audio.dispose();dom.window.close();
  });
  it('a rejected Safari play keeps the activation control necessary until a successful tap',async()=>{
    const dom=new JSDOM('<main></main>');let blocked=true;
    class Context {state='running';resume(){return Promise.resolve();}close(){}}
    dom.window.HTMLMediaElement.prototype.pause=()=>{};dom.window.HTMLMediaElement.prototype.play=()=>blocked?Promise.reject(Object.assign(new Error('blocked'),{name:'NotAllowedError'})):Promise.resolve();
    const audio=createCallAudio(dom.window.document,{AudioContext:Context,navigator:{},setInterval:()=>1,clearInterval:()=>{}});await audio.activate();await assert.rejects(audio.attach({getAudioTracks:()=>[]}),{name:'NotAllowedError'});assert.equal(audio.needsActivation(),true);blocked=false;await audio.activate();assert.equal(audio.needsActivation(),false);audio.dispose();dom.window.close();
  });
});
