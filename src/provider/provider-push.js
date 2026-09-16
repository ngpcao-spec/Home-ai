const INSTALLATION_KEY='home-ai-provider-push-installation';
const decodeKey=value=>{const padding='='.repeat((4-value.length%4)%4);const raw=atob((value+padding).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));};
const installed=env=>env.matchMedia?.('(display-mode: standalone)')?.matches===true||env.navigator?.standalone===true;
export function renderProviderPushPrompt(state={status:'enabled'}){
  if(state.status==='prompt')return `<aside class="provider-push-prompt" data-provider-push-prompt role="status"><div><strong>Bật thông báo để nhận nhiệm vụ mới</strong><small>HOME AI sẽ báo cho bạn khi có nhiệm vụ mới, kể cả khi ứng dụng không ở phía trước.</small></div><button type="button" data-enable-provider-push>Cho phép thông báo</button></aside>`;
  if(state.status==='requesting')return `<aside class="provider-push-prompt" data-provider-push-prompt role="status"><div><strong>Đang bật thông báo…</strong><small>Vui lòng xác nhận trong yêu cầu của hệ thống.</small></div><button type="button" disabled>Đang xử lý…</button></aside>`;
  if(state.status==='install-required')return `<aside class="provider-push-notice" data-provider-push-prompt role="status"><strong>Thêm HOME AI vào Màn hình chính</strong><small>Mở HOME AI từ biểu tượng trên Màn hình chính, sau đó cho phép thông báo để nhận nhiệm vụ mới.</small></aside>`;
  if(state.status==='denied')return `<aside class="provider-push-notice" data-provider-push-prompt role="status"><strong>Thông báo hệ thống đang bị tắt</strong><small>Thông báo cần được bật trong cài đặt iPhone để bạn nhận được cảnh báo nhiệm vụ mới.</small></aside>`;
  if(state.status==='unavailable'&&state.message)return `<aside class="provider-push-notice" data-provider-push-prompt role="status"><strong>Không thể bật thông báo</strong><small>${state.message}</small></aside>`;
  return '';
}
export function createProviderPushManager({environment=globalThis,repository,vapidPublicKey}){
  let registration=null,state={status:'enabled'},started=false,lastTouchedAt=0,lastForeground,onStateChange=()=>{},enablePromise=null;
  const setState=next=>{state=next;onStateChange(next);return next;};
  const installationId=()=>{let id=environment.localStorage?.getItem(INSTALLATION_KEY);if(!id){id=environment.crypto.randomUUID();environment.localStorage?.setItem(INSTALLATION_KEY,id);}return id;};
  const supported=()=>Boolean(environment.isSecureContext&&environment.navigator?.serviceWorker&&environment.PushManager&&environment.Notification);
  const subscriptionValue=subscription=>{const value=subscription?.toJSON?.();if(!value?.endpoint||!value.keys?.p256dh||!value.keys?.auth)throw new Error('Invalid PushSubscription');return value;};
  const touch=(force=false)=>{
    const foreground=environment.document?.visibilityState==='visible';
    const now=Date.now();
    if(!force&&foreground===lastForeground&&now-lastTouchedAt<900000)return;
    lastForeground=foreground;lastTouchedAt=now;
    repository.touchPush?.(installationId(),foreground).catch(()=>{});
  };
  const syncSubscription=async subscription=>{
    const value=subscriptionValue(subscription);
    await repository.registerPush({installationId:installationId(),endpoint:value.endpoint,p256dh:value.keys.p256dh,auth:value.keys.auth});
    touch(true);
    return setState({status:'enabled'});
  };
  const ensureSubscription=async()=>{
    registration??=await environment.navigator.serviceWorker.ready;
    let current=await registration.pushManager.getSubscription();
    if(current?.expirationTime&&current.expirationTime<=Date.now()){await current.unsubscribe?.();current=null;}
    const subscription=current??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(vapidPublicKey)});
    return syncSubscription(subscription);
  };
  const refresh=async()=>{
    if(!installed(environment))return setState({status:'install-required'});
    if(!supported()||!vapidPublicKey)return setState({status:'unavailable'});
    if(environment.Notification.permission==='denied')return setState({status:'denied'});
    if(environment.Notification.permission!=='granted')return setState({status:'prompt'});
    try{return await ensureSubscription();}catch{return setState({status:'unavailable',message:'Vui lòng mở lại HOME AI và thử lại.'});}
  };
  const visibility=()=>{if(environment.document?.visibilityState==='visible')void refresh();else touch(true);};
  return Object.freeze({
    async state(){return refresh();},
    async enable(){if(enablePromise)return enablePromise;enablePromise=(async()=>{if(!installed(environment))return setState({status:'install-required'});if(!supported()||!vapidPublicKey)return setState({status:'unavailable'});if(environment.Notification.permission==='denied')return setState({status:'denied'});const permission=environment.Notification.permission==='granted'?'granted':await environment.Notification.requestPermission();if(permission!=='granted')return setState({status:'denied'});try{return await ensureSubscription();}catch{return setState({status:'unavailable',message:'Không thể đăng ký thiết bị. Vui lòng thử lại.'});}})();try{return await enablePromise;}finally{enablePromise=null;}},
    async start(listener){if(listener)onStateChange=listener;if(!started){started=true;environment.document?.addEventListener?.('visibilitychange',visibility);}return refresh();},
    async revoke(){await repository.revokePush?.(installationId());},
    async resolveLaunch(){const url=new URL(environment.location.href);const ref=url.searchParams.get('push_offer');if(!ref)return null;url.searchParams.delete('push_offer');environment.history?.replaceState?.({},'',url);return repository.resolvePushOffer?.(ref);},
    stop(){started=false;environment.document?.removeEventListener?.('visibilitychange',visibility);},
  });
}
