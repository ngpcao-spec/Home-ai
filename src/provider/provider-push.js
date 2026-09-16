const INSTALLATION_KEY='home-ai-provider-push-installation';
const decodeKey=value=>{const padding='='.repeat((4-value.length%4)%4);const raw=atob((value+padding).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));};
const installed=env=>env.matchMedia?.('(display-mode: standalone)')?.matches===true||env.navigator?.standalone===true;
export function renderProviderPushSettings(state={status:'disabled'}){
  const labels={enabled:'Đã bật',denied:'Bị từ chối / không khả dụng',unavailable:'Bị từ chối / không khả dụng',disabled:'Chưa bật'};
  return `<section class="provider-push-settings"><p class="pricing-kicker">THÔNG BÁO</p><h2>Thông báo nhiệm vụ</h2><strong data-provider-push-status>${labels[state.status]??labels.disabled}</strong>${state.message?`<small>${state.message}</small>`:''}${state.status==='disabled'?'<button type="button" data-enable-provider-push>Bật thông báo</button>':''}</section>`;
}
export function createProviderPushManager({environment=globalThis,repository,vapidPublicKey}){
  let registration=null,state={status:'disabled'},started=false,lastTouchedAt=0,lastForeground;
  const installationId=()=>{let id=environment.localStorage?.getItem(INSTALLATION_KEY);if(!id){id=environment.crypto.randomUUID();environment.localStorage?.setItem(INSTALLATION_KEY,id);}return id;};
  const supported=()=>Boolean(environment.isSecureContext&&environment.navigator?.serviceWorker&&environment.PushManager&&environment.Notification);
  const refresh=async()=>{if(!supported()||!vapidPublicKey)return state={status:'unavailable'};if(environment.Notification.permission==='denied')return state={status:'denied'};registration??=await environment.navigator.serviceWorker.ready;const subscription=await registration.pushManager.getSubscription();return state={status:subscription?'enabled':'disabled'};};
  const touch=(force=false)=>{
    const foreground=environment.document?.visibilityState==='visible';
    const now=Date.now();
    if(!force&&foreground===lastForeground&&now-lastTouchedAt<900000)return;
    lastForeground=foreground;lastTouchedAt=now;
    repository.touchPush?.(installationId(),foreground).catch(()=>{});
  };
  const visibility=()=>touch(true);
  return Object.freeze({
    async state(){return refresh();},
    async enable(){if(!supported()||!vapidPublicKey)return state={status:'unavailable'};if(!installed(environment))return state={status:'disabled',message:'Hãy thêm HOME AI vào Màn hình chính để bật thông báo.'};const permission=await environment.Notification.requestPermission();if(permission!=='granted')return state={status:'denied'};registration??=await environment.navigator.serviceWorker.ready;const current=await registration.pushManager.getSubscription();const subscription=current??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(vapidPublicKey)});const value=subscription.toJSON();await repository.registerPush({installationId:installationId(),endpoint:value.endpoint,p256dh:value.keys?.p256dh,auth:value.keys?.auth});touch(true);return state={status:'enabled'};},
    start(){if(started)return;started=true;touch(true);environment.document?.addEventListener?.('visibilitychange',visibility);},
    async revoke(){await repository.revokePush?.(installationId());},
    async resolveLaunch(){const url=new URL(environment.location.href);const ref=url.searchParams.get('push_offer');if(!ref)return null;url.searchParams.delete('push_offer');environment.history?.replaceState?.({},'',url);return repository.resolvePushOffer?.(ref);},
    stop(){started=false;environment.document?.removeEventListener?.('visibilitychange',visibility);},
  });
}
