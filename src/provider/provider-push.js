const INSTALLATION_KEY='home-ai-provider-push-installation';
export const PROVIDER_PUSH_FOREGROUND_HEARTBEAT_MS=15000;
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
  let registration=null,state={status:'enabled'},started=false,onStateChange=()=>{},enablePromise=null;
  let heartbeatTimer=null,touchInFlight=null,pendingForeground=null;
  const setState=next=>{state=next;onStateChange(next);return next;};
  const installationId=()=>{let id=environment.localStorage?.getItem(INSTALLATION_KEY);if(!id){id=environment.crypto.randomUUID();environment.localStorage?.setItem(INSTALLATION_KEY,id);}return id;};
  const supported=()=>Boolean(environment.isSecureContext&&environment.navigator?.serviceWorker&&environment.PushManager&&environment.Notification);
  const subscriptionValue=subscription=>{const value=subscription?.toJSON?.();if(!value?.endpoint||!value.keys?.p256dh||!value.keys?.auth)throw new Error('Invalid PushSubscription');return value;};
  const touch=foreground=>{
    pendingForeground=foreground;
    if(touchInFlight)return touchInFlight;
    const run=async()=>{while(pendingForeground!==null){const next=pendingForeground;pendingForeground=null;try{await repository.touchPush?.(installationId(),next);}catch{}}};
    touchInFlight=run().finally(()=>{touchInFlight=null;if(pendingForeground!==null)void touch(pendingForeground);});
    return touchInFlight;
  };
  const stopHeartbeat=()=>{if(heartbeatTimer!==null){environment.clearInterval?.(heartbeatTimer);heartbeatTimer=null;}};
  const startHeartbeat=()=>{
    if(!started||heartbeatTimer!==null||state.status!=='enabled'||environment.document?.visibilityState!=='visible')return;
    heartbeatTimer=environment.setInterval?.(()=>{
      if(environment.document?.visibilityState==='visible')void touch(true);
      else{stopHeartbeat();void touch(false);}
    },PROVIDER_PUSH_FOREGROUND_HEARTBEAT_MS)??null;
  };
  const syncSubscription=async subscription=>{
    const value=subscriptionValue(subscription);
    await repository.registerPush({installationId:installationId(),endpoint:value.endpoint,p256dh:value.keys.p256dh,auth:value.keys.auth});
    const next=setState({status:'enabled'});
    if(environment.document?.visibilityState==='visible'){void touch(true);startHeartbeat();}
    else void touch(false);
    return next;
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
  const visibility=()=>{if(environment.document?.visibilityState==='visible'){void touch(true);startHeartbeat();void refresh();}else{stopHeartbeat();void touch(false);}};
  return Object.freeze({
    async state(){return refresh();},
    async enable(){if(enablePromise)return enablePromise;enablePromise=(async()=>{if(!installed(environment))return setState({status:'install-required'});if(!supported()||!vapidPublicKey)return setState({status:'unavailable'});if(environment.Notification.permission==='denied')return setState({status:'denied'});const permission=environment.Notification.permission==='granted'?'granted':await environment.Notification.requestPermission();if(permission!=='granted')return setState({status:'denied'});try{return await ensureSubscription();}catch{return setState({status:'unavailable',message:'Không thể đăng ký thiết bị. Vui lòng thử lại.'});}})();try{return await enablePromise;}finally{enablePromise=null;}},
    async start(listener){if(listener)onStateChange=listener;if(!started){started=true;environment.document?.addEventListener?.('visibilitychange',visibility);}return refresh();},
    async revoke(){started=false;stopHeartbeat();environment.document?.removeEventListener?.('visibilitychange',visibility);await repository.revokePush?.(installationId());},
    async resolveLaunch(){const url=new URL(environment.location.href);const ref=url.searchParams.get('push_offer');if(!ref)return null;url.searchParams.delete('push_offer');environment.history?.replaceState?.({},'',url);return repository.resolvePushOffer?.(ref);},
    async resolveMessageLaunch(){const url=new URL(environment.location.href);const ref=url.searchParams.get('push_message');if(!ref)return null;url.searchParams.delete('push_message');environment.history?.replaceState?.({},'',url);return repository.resolvePushMessage?.(ref);},
    stop(){started=false;stopHeartbeat();environment.document?.removeEventListener?.('visibilitychange',visibility);void touch(false);},
  });
}
