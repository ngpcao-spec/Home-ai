import { createClient } from 'npm:@supabase/supabase-js@2';
import { providerKycSchema, validateProviderKycExtraction, validateProviderKycRequest } from '../_shared/provider-kyc-contract.ts';
import { providerKycInstructions } from '../_shared/provider-kyc-instructions.js';
import { prepareProviderKycImage } from '../_shared/provider-kyc-image.ts';

const origins=new Set(['https://ngpcao-spec.github.io','http://localhost:3000','http://127.0.0.1:3000']);
const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
const respond=(origin:string,status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...headers,'Access-Control-Allow-Origin':origin,Vary:'Origin'}});
const fail=(origin:string,status:number,code:string)=>respond(origin,status,{error:{code}});
const log=(event:string,status?:number)=>console.info(JSON.stringify({component:'analyze-provider-identity',event,...(status?{status}:{})}));
const outputText=(payload:Record<string,unknown>)=>{if(typeof payload.output_text==='string')return payload.output_text;const parts:string[]=[];for(const item of Array.isArray(payload.output)?payload.output:[])for(const part of Array.isArray((item as {content?:unknown[]})?.content)?(item as {content:unknown[]}).content:[])if(typeof (part as {text?:unknown})?.text==='string')parts.push((part as {text:string}).text);if(!parts.length)throw new Error('AI_INVALID_RESPONSE');return parts.join('\n');};
const base64=(bytes:Uint8Array)=>{let binary='';for(let index=0;index<bytes.length;index+=0x8000)binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000));return btoa(binary);};
const TEST_PROVIDER_ID='2040840f-10c6-4acf-a800-1640e1520f4b';
const TEST_PROVIDER_NAME='Provider Test Nha Trang';
const decodeBase64=(value:string)=>{const binary=atob(value);const bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);return bytes;};

Deno.serve(async request=>{
  const origin=request.headers.get('Origin')??'';if(!origins.has(origin))return fail('null',403,'ORIGIN_FORBIDDEN');
  const cors={...headers,'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS',Vary:'Origin'};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST'||!request.headers.get('content-type')?.toLowerCase().includes('application/json'))return fail(origin,400,'INVALID_REQUEST');
  const authorization=request.headers.get('Authorization')??'';const token=authorization.startsWith('Bearer ')?authorization.slice(7).trim():'';
  if(!token)return fail(origin,401,'AUTH_REQUIRED');
  const client=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_ANON_KEY')??'',{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await client.auth.getUser(token);if(userError||!userData.user)return fail(origin,401,'AUTH_REQUIRED');
  const {data:profile}=await client.from('profiles').select('role,status,display_name').eq('user_id',userData.user.id).maybeSingle();if(profile?.role!=='provider'||profile.status!=='active')return fail(origin,403,'PROVIDER_REQUIRED');
  let input;try{input=validateProviderKycRequest(await request.json(),userData.user.id);}catch{return fail(origin,400,'INVALID_INPUT');}
  if(input.kind==='test-preview'){
    const {data:providerProfile}=await client.from('provider_profiles').select('kyc_status').eq('provider_id',userData.user.id).maybeSingle();
    if(userData.user.id!==TEST_PROVIDER_ID||profile.display_name!==TEST_PROVIDER_NAME||providerProfile?.kyc_status!=='verified')return fail(origin,403,'TEST_PREVIEW_FORBIDDEN');
  }
  log('authenticated_request');
  let image;try{
    if(input.kind==='stored'){
      const {data:file,error:downloadError}=await client.storage.from('provider-kyc').download(input.documentPath);
      if(downloadError||!file)return fail(origin,404,'DOCUMENT_NOT_FOUND');
      if(!file.size||file.size>8388608)return fail(origin,400,'INVALID_DOCUMENT');
      image=await prepareProviderKycImage(new Uint8Array(await file.arrayBuffer()),input.documentPath.split('.').at(-1)??'');
    }else{
      const bytes=decodeBase64(input.imageBase64);if(!bytes.length||bytes.length>8388608)return fail(origin,400,'INVALID_DOCUMENT');
      const extension=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'} as Record<string,string>)[input.contentType];
      image=await prepareProviderKycImage(bytes,extension);
    }
  }catch{return fail(origin,400,'INVALID_DOCUMENT');}
  const apiKey=Deno.env.get('OPENAI_API_KEY')??'';if(!apiKey)return fail(origin,503,'AI_UNAVAILABLE');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const imageUrl=`data:${image.mimeType};base64,${base64(image.bytes)}`;
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({
      model:Deno.env.get('OPENAI_VISION_MODEL')||'gpt-5-mini',reasoning:{effort:'minimal'},max_output_tokens:700,store:false,instructions:providerKycInstructions,
      input:[{role:'user',content:[{type:'input_text',text:'Extract the permitted fields from this CCCD front image.'},{type:'input_image',image_url:imageUrl,detail:'high'}]}],
      text:{format:{type:'json_schema',name:'provider_kyc_extraction',strict:true,schema:providerKycSchema}},
    })});
    log('openai_response',response.status);if(response.status===429)return fail(origin,429,'AI_RATE_LIMIT');if(response.status>=500)return fail(origin,503,'AI_UNAVAILABLE');if(!response.ok)return fail(origin,502,'AI_REQUEST_FAILED');
    const extraction=validateProviderKycExtraction(JSON.parse(outputText(await response.json())));log('json_validated');
    if(!extraction.documentReadable)return respond(origin,422,{error:{code:'DOCUMENT_UNREADABLE'}});
    if(input.kind==='test-preview')return respond(origin,200,{testPreview:true,extraction});
    const {data:saved,error:saveError}=await client.rpc('save_current_provider_kyc_extraction',{new_document_path:input.documentPath,new_extraction:extraction});
    if(saveError)return fail(origin,500,'SAVE_FAILED');
    return respond(origin,200,{submission:saved.submission});
  }catch(error){if(error instanceof DOMException&&error.name==='AbortError')return fail(origin,504,'AI_TIMEOUT');return fail(origin,502,'AI_INVALID_RESPONSE');}
  finally{clearTimeout(timer);}
});
