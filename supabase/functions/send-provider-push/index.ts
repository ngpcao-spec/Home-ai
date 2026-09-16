import webpush from 'npm:web-push@3.6.7';
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {VAPID_PUBLIC_KEY} from '../_shared/provider-push-config.js';

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const labels:Record<string,string>={electricity:'thợ điện',plumbing:'thợ sửa ống nước','air-conditioning':'thợ điều hòa',appliances:'thợ điện gia dụng'};
const decode=(value:string)=>{const normalized=value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=');return Uint8Array.from(atob(normalized),character=>character.charCodeAt(0));};
const encode=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const normalizeSecret=(value:string)=>{const trimmed=value.trim();return(/^(["']).*\1$/s.test(trimmed)?trimmed.slice(1,-1):trimmed).trim();};
const vapidConfiguration=async()=>{
  const privateKey=normalizeSecret(Deno.env.get('VAPID_PRIVATE_KEY')??'');
  const subject=normalizeSecret(Deno.env.get('VAPID_SUBJECT')??'');
  const privateKeyPresent=Boolean(privateKey);const subjectPresent=Boolean(subject);
  try{const rawPublic=decode(VAPID_PUBLIC_KEY);const rawPrivate=decode(privateKey);if(rawPublic.length!==65||rawPublic[0]!==4||rawPrivate.length!==32)throw new Error('INVALID_VAPID_KEY');const base={kty:'EC',crv:'P-256',x:encode(rawPublic.subarray(1,33)),y:encode(rawPublic.subarray(33,65)),ext:true};const algorithm={name:'ECDSA',namedCurve:'P-256'};const signingKey=await crypto.subtle.importKey('jwk',{...base,d:encode(rawPrivate)},algorithm,false,['sign']);const verificationKey=await crypto.subtle.importKey('jwk',base,algorithm,false,['verify']);const message=new TextEncoder().encode('HOME AI VAPID pair verification');const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signingKey,message);const pairMatches=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},verificationKey,signature,message);return{configured:subjectPresent&&privateKeyPresent,privateKeyPresent,subjectPresent,privateKeyValid:true,pairMatches,privateKey,subject};}
  catch{return{configured:false,privateKeyPresent,subjectPresent,privateKeyValid:false,pairMatches:false,privateKey:'',subject:''};}
};
Deno.serve(async(req)=>{
  if(req.method==='GET'){const config=await vapidConfiguration();return json({active:true,vapidConfigured:config.configured,vapidPrivateKeyPresent:config.privateKeyPresent,vapidSubjectPresent:config.subjectPresent,vapidPrivateKeyValid:config.privateKeyValid,vapidPairMatches:config.pairMatches});}
  try{
    const hook=await req.json();const outboxId=hook?.record?.id??hook?.outbox_id;
    if(!outboxId)return json({error:'INVALID_REQUEST'},400);
    const supabase=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const {data:claimed,error:claimError}=await supabase.rpc('claim_provider_push_outbox',{target_outbox_id:outboxId,provided_secret:req.headers.get('x-home-ai-push-secret')??''});
    if(claimError)return json({error:'PUSH_AUTHORIZATION_FAILED'},503);
    if(!claimed)return json({error:'FORBIDDEN'},403);
    const {data:outbox}=await supabase.from('provider_push_outbox').select('id,offer_id,provider_id,status,attempts').eq('id',outboxId).maybeSingle();
    if(!outbox||outbox.status!=='processing')return json({processed:false});
    const {data:offer}=await supabase.from('mission_offers').select('id,push_reference,status,expires_at,mission_id,provider_id').eq('id',outbox.offer_id).maybeSingle();
    const {data:mission}=offer?await supabase.from('missions').select('status,service_category,provider_id').eq('id',offer.mission_id).maybeSingle():{data:null};
    const {data:provider}=await supabase.from('provider_status').select('online,available,current_mission_id').eq('provider_id',outbox.provider_id).maybeSingle();
    const valid=offer?.status==='pending'&&new Date(offer.expires_at).getTime()>Date.now()&&mission?.status==='offered'&&!mission.provider_id&&provider?.online&&provider?.available&&!provider.current_mission_id;
    if(!valid){await supabase.from('provider_push_outbox').update({status:'skipped',processed_at:new Date().toISOString(),last_error_code:'OFFER_NOT_DELIVERABLE'}).eq('id',outbox.id);return json({processed:true,sent:0});}
    const {data:subscriptions}=await supabase.from('provider_push_subscriptions').select('id,endpoint,p256dh,auth_key,foreground_until').eq('provider_id',outbox.provider_id).eq('enabled',true);
    const config=await vapidConfiguration();if(!config.configured||!config.pairMatches){await supabase.from('provider_push_outbox').update({status:'failed',processed_at:new Date().toISOString(),last_error_code:'VAPID_CONFIGURATION_INVALID'}).eq('id',outbox.id);return json({error:'PUSH_CONFIGURATION_ERROR'},503);}
    webpush.setVapidDetails(config.subject,VAPID_PUBLIC_KEY,config.privateKey);
    const payload=JSON.stringify({type:'mission_offer',offerRef:offer.push_reference,title:'HOME AI — Nhiệm vụ mới',body:`Có khách hàng cần ${labels[mission.service_category]??'thợ phù hợp'} gần bạn.`});
    let sent=0;for(const subscription of subscriptions??[]){
      if(subscription.foreground_until&&new Date(subscription.foreground_until).getTime()>Date.now())continue;
      try{await webpush.sendNotification({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth_key}},payload,{TTL:Math.max(0,Math.floor((new Date(offer.expires_at).getTime()-Date.now())/1000)),urgency:'high'});sent++;}
      catch(error){const code=Number((error as {statusCode?:number}).statusCode);if(code===404||code===410)await supabase.from('provider_push_subscriptions').update({enabled:false,revoked_at:new Date().toISOString()}).eq('id',subscription.id);}
    }
    await supabase.from('provider_push_outbox').update({status:'sent',processed_at:new Date().toISOString(),last_error_code:null}).eq('id',outbox.id);
    return json({processed:true,sent});
  }catch{return json({error:'PUSH_DELIVERY_FAILED'},500);}
});
