import { createProgressiveProviderAppRepository } from './provider-repository.js';
import { prepareProviderNavigation, renderProviderNavigation } from './provider-navigation.js';
import { createProviderGoogleAuth } from './provider-auth.js';
import { createProviderLocationHeartbeat } from './provider-location-heartbeat.js';

const labels = { electricity:'Điện', plumbing:'Nước', 'air-conditioning':'Điều hòa', appliances:'Điện gia dụng' };
const esc = (v='') => String(v).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const money = (value) => `${new Intl.NumberFormat('vi-VN').format(value ?? 0)}đ`;
const statusLabel = { accepted:'Đã nhận nhiệm vụ', travelling:'Đang di chuyển', arrived:'Đã đến nơi', quote_pending:'Báo giá đã được chấp nhận', supplement_pending:'Đang chờ duyệt bổ sung', in_progress:'Đang thực hiện', completed_pending_payment:'Đã hoàn tất · chờ thanh toán' };
function renderQuoteWorkflow(assignment, { diagnosing=false, busy=false }={}) {
  if (assignment.quote && !['declined','rejected'].includes(assignment.quote.status)) { const accepted=assignment.quote.status==='accepted'; return `<section class="provider-quote provider-quote--waiting"><p>BÁO GIÁ V${assignment.quote.version}</p><h3>${esc(assignment.quote.diagnosis)}</h3><strong>${money(assignment.quote.totalAmount)}</strong><span>${accepted?'Khách hàng đã chấp nhận':'Đã gửi cho khách hàng'}</span><div class="waiting-pulse">${accepted?'✓ Công việc đã được phê duyệt':'⌛ Đang chờ khách hàng chấp nhận'}</div><small>${accepted?'Nội dung báo giá này đã khóa; mọi thay đổi phải tạo phiên bản mới.':'Không bắt đầu công việc tính phí trước khi khách hàng chấp nhận rõ ràng.'}</small>${accepted&&assignment.status==='quote_pending'?`<button data-start-intervention ${busy?'disabled':''}>Bắt đầu thực hiện</button>`:''}${assignment.status==='in_progress'?`<button data-finish-intervention ${busy?'disabled':''}>Hoàn tất công việc</button>`:''}</section>`; }
  if (assignment.status !== 'arrived') return '';
  if (!diagnosing) return `<button class="diagnosis-start" data-start-diagnosis ${busy?'disabled':''}>Bắt đầu chẩn đoán</button>`;
  return `<section class="provider-quote"><p>CHẨN ĐOÁN & BÁO GIÁ</p><label>Kết quả chẩn đoán<textarea data-quote-diagnosis rows="3" placeholder="Mô tả nguyên nhân và phương án xử lý"></textarea></label><div class="quote-grid"><label>Công thợ (VND)<input data-quote-labor type="number" min="0" step="1000" value="150000"></label><label>Linh kiện (VND)<input data-quote-parts type="number" min="0" step="1000" value="50000"></label></div><label>Bảo hành (ngày)<input data-quote-warranty type="number" min="0" max="3650" value="30"></label><button data-send-quote ${busy?'disabled':''}>Gửi báo giá cho khách hàng</button><small>Việc gửi báo giá không cho phép bắt đầu công việc tính phí.</small></section>`;
}
export function renderProviderDashboard(state, { source='mock', busy=false, message='', navigation=null, diagnosing=false }={}) {
  const offers = state.offers ?? [];
  const assignment = state.assignment;
  return `<header class="provider-header"><div class="brand"><span>H</span><div><strong>HOME AI</strong><small>Đối tác kỹ thuật</small></div></div><button class="avatar" data-provider-logout aria-label="Đăng xuất">${esc(state.provider?.name?.split(' ').at(-1)?.[0] ?? 'P')}</button></header>
  <main><section class="welcome"><div><p>Xin chào,</p><h1>${esc(state.provider?.name ?? 'Kỹ thuật viên')}</h1><span class="verified">✓ Đã xác minh</span></div><span class="source">${source==='supabase'?'Đã kết nối':'Chế độ demo'}</span></section>
  <section class="status-card"><div><p>Trạng thái hoạt động</p><strong>${state.status?.online?'Đang trực tuyến':'Đang ngoại tuyến'}</strong></div><button class="switch ${state.status?.online?'on':''}" data-toggle-online aria-pressed="${Boolean(state.status?.online)}"><span></span></button><label><input type="checkbox" data-toggle-available ${state.status?.available?'checked':''} ${!state.status?.online||assignment?'disabled':''}> Sẵn sàng nhận việc</label></section>
  ${assignment?`<section class="assignment"><p>NHIỆM VỤ ĐANG THỰC HIỆN</p><h2>${esc(labels[assignment.serviceCategory]??assignment.serviceCategory)}</h2><strong>${esc(assignment.address)}</strong><p>${esc(assignment.request)}</p><span>● ${statusLabel[assignment.status]??assignment.status}</span>${['accepted','travelling'].includes(assignment.status)?`<div class="provider-map" data-provider-map aria-label="Bản đồ đường đến khách hàng"></div>${navigation?`<div class="route-summary"><strong>${Number(navigation.route.distanceKm).toFixed(1)} km</strong><span>ETA ${navigation.route.durationMinutes} phút</span><small>GPS: ${navigation.providerLocation.latitude.toFixed(5)}, ${navigation.providerLocation.longitude.toFixed(5)}</small></div>`:'<div class="route-loading">Đang chuẩn bị lộ trình…</div>'}`:''}<div class="mission-actions">${assignment.status==='accepted'?`<button data-start-travel ${busy?'disabled':''}>Bắt đầu di chuyển</button>`:''}${assignment.status==='travelling'?`<button data-mark-arrived ${busy||!navigation?.arrived?'disabled':''}>Tôi đã đến</button>${!navigation?.arrived?'<small>Nút được mở khi bạn ở trong phạm vi 150 m.</small>':''}`:''}</div>${renderQuoteWorkflow(assignment,{diagnosing,busy})}</section>`:''}
  <section class="offers"><div class="section-title"><div><p>CƠ HỘI GẦN BẠN</p><h2>Đề nghị nhiệm vụ</h2></div><span>${offers.length}</span></div>${offers.length?offers.map(o=>`<article class="offer-card"><div class="offer-top"><span class="service-icon">${o.serviceCategory==='electricity'?'⚡':'🛠'}</span><div><h3>${esc(labels[o.serviceCategory]??o.serviceCategory)}</h3><p>${esc(o.approximateAddress)}</p></div><strong>${Number(o.distanceKm).toFixed(1)} km</strong></div><p class="request">${esc(o.request)}</p><div class="facts"><span>◷ ${o.etaMinutes} phút</span><span>⌖ Địa chỉ gần đúng</span></div><div class="actions"><button data-decline="${esc(o.id)}" ${busy?'disabled':''}>Từ chối</button><button data-accept="${esc(o.id)}" ${busy||assignment?'disabled':''}>Chấp nhận</button></div></article>`).join(''):`<div class="empty">Không có đề nghị mới.<small>Hãy duy trì trạng thái trực tuyến để nhận việc.</small></div>`}</section><p class="app-message" role="status">${esc(message)}</p></main>
  <nav><button class="active">⌂<span>Trang chủ</span></button><button>▤<span>Nhiệm vụ</span></button><button>◎<span>Thu nhập</span></button><button>○<span>Hồ sơ</span></button></nav>`;
}

export function renderProviderLogin({ error = '', provisioning = false } = {}) {
  return `<main class="provider-auth"><div class="brand"><span>H</span><div><strong>HOME AI</strong><small>Đối tác kỹ thuật</small></div></div><h1>${provisioning ? 'Tài khoản chưa được kích hoạt' : 'Đăng nhập đối tác'}</h1><p>${provisioning ? 'Tài khoản Google đã được xác thực. Quản trị viên HOME AI phải cấp vai trò provider, KYC và dịch vụ trước khi tiếp tục.' : 'Sử dụng tài khoản Google dành riêng cho kỹ thuật viên thử nghiệm.'}</p>${provisioning ? '<button data-provider-logout>Đăng xuất</button>' : '<button data-provider-google-login><strong>G</strong> Tiếp tục với Google</button>'}<p class="app-message" role="status">${esc(error)}</p></main>`;
}

export function renderProviderStartupError(safeStage = 'STARTUP') {
  return `<main class="provider-auth" data-provider-startup-error><div class="brand"><span>H</span><div><strong>HOME AI</strong><small>Đối tác kỹ thuật</small></div></div><h1>Không thể khởi động ứng dụng</h1><p>Vui lòng tải lại trang. Nếu lỗi vẫn còn, hãy cung cấp mã chẩn đoán bên dưới.</p><small data-provider-error-stage>Mã: ${esc(safeStage)}</small><button type="button" data-provider-reload>Tải lại</button></main>`;
}

export async function initialiseProviderApp(root, repositoryLoader=createProgressiveProviderAppRepository, navigationLoader=prepareProviderNavigation, auth=createProviderGoogleAuth(), heartbeatFactory=createProviderLocationHeartbeat) {
  let session;
  try{session=await auth.getSession();}catch(error){if(!error.safeStage)error.safeStage='AUTH_SESSION';throw error;}
  if(auth.enabled&&!session?.user){root.innerHTML=renderProviderLogin();root.addEventListener('click',async e=>{if(!e.target.closest('[data-provider-google-login]'))return;try{await auth.signIn();}catch{root.innerHTML=renderProviderLogin({error:'Không thể đăng nhập bằng Google. Vui lòng thử lại.'});}});return{getState:()=>null};}
  let repository;
  try{repository=await repositoryLoader();}catch{root.innerHTML=renderProviderLogin({provisioning:true});root.addEventListener('click',async e=>{if(e.target.closest('[data-provider-logout]')){await auth.signOut();globalThis.location?.reload();}});return{getState:()=>null};}
  let state;
  try{state=await repository.load();}catch(error){error.safeStage='DASHBOARD_LOAD';throw error;}
  let busy=false; let message=''; let navigation=null; let diagnosing=false;
  const draw=async()=>{root.innerHTML=renderProviderDashboard(state,{source:repository.source,busy,message,navigation,diagnosing});const map=root.querySelector('[data-provider-map]');if(navigation&&map)await renderProviderNavigation(map,navigation,state.provider).catch(()=>{});};
  const loadNavigation=async()=>{if(!['accepted','travelling'].includes(state.assignment?.status))return;try{navigation=await navigationLoader(state.assignment,{source:repository.source});}catch{message='Không thể tải lộ trình. GPS vẫn sẵn sàng để thử lại.';}};
  await loadNavigation(); await draw();
  const page=root.ownerDocument??globalThis.document;
  const heartbeat=heartbeatFactory({repository,getState:()=>state,isPageActive:()=>!page?.hidden,onState:async next=>{state=next;message='Vị trí GPS đã được cập nhật.';await draw();},onError:async()=>{message='Không thể cập nhật GPS. Hãy cho phép truy cập vị trí.';await draw();}});
  const syncHeartbeat=()=>heartbeat.sync();
  page?.addEventListener?.('visibilitychange',syncHeartbeat);
  globalThis.addEventListener?.('pagehide',heartbeat.stop,{once:true});
  heartbeat.sync();
  root.addEventListener('click',async e=>{const logout=e.target.closest('[data-provider-logout]');const online=e.target.closest('[data-toggle-online]');const accept=e.target.closest('[data-accept]');const decline=e.target.closest('[data-decline]');const start=e.target.closest('[data-start-travel]');const arrived=e.target.closest('[data-mark-arrived]');const diagnose=e.target.closest('[data-start-diagnosis]');const send=e.target.closest('[data-send-quote]');const begin=e.target.closest('[data-start-intervention]');const finish=e.target.closest('[data-finish-intervention]');if(logout){heartbeat.stop();await auth.signOut();globalThis.location?.reload();return;}if(!online&&!accept&&!decline&&!start&&!arrived&&!diagnose&&!send&&!begin&&!finish)return;if(diagnose){diagnosing=true;await draw();return;}busy=true;await draw();try{if(online){const next=!state.status.online;state=await repository.setAvailability({online:next,available:next&&state.status.available});}if(accept){state=await repository.accept(accept.dataset.accept);await loadNavigation();}if(decline)state=await repository.decline(decline.dataset.decline);if(start||arrived){navigation=await navigationLoader(state.assignment,{source:repository.source});if(arrived&&!navigation.arrived)throw new Error('Provider not at destination');state=await repository.updateMissionProgress(state.assignment.id,start?'travelling':'arrived',navigation.providerLocation);}if(send){const draft={diagnosis:root.querySelector('[data-quote-diagnosis]').value,laborAmount:root.querySelector('[data-quote-labor]').value,partsAmount:root.querySelector('[data-quote-parts]').value,warrantyDays:root.querySelector('[data-quote-warranty]').value,laborDescription:'Công kiểm tra và sửa chữa',partsDescription:'Linh kiện dự kiến'};state=await repository.createQuote(state.assignment.id,draft);diagnosing=false;}if(begin)state=await repository.startIntervention(state.assignment.id);if(finish)state=await repository.finishIntervention(state.assignment.id);message='Đã cập nhật thành công.';}catch{message='Không thể cập nhật. Vui lòng thử lại.';}finally{busy=false;heartbeat.sync();await draw();}});
  root.addEventListener('change',async e=>{if(!e.target.matches('[data-toggle-available]'))return;busy=true;await draw();try{state=await repository.setAvailability({online:state.status.online,available:e.target.checked});message='Đã cập nhật khả dụng.';}catch{message='Không thể cập nhật.';}finally{busy=false;heartbeat.sync();await draw();}});
  return {getState:()=>structuredClone(state),stop:heartbeat.stop};
}

export async function bootstrapProviderApp(root, initialise=initialiseProviderApp) {
  if (!root) return null;
  try {
    const app=await initialise(root);
    globalThis.__HOME_AI_PROVIDER_READY__=true;
    return app;
  } catch(error) {
    const safeStage=error?.safeStage??'STARTUP';
    console.error('[HOME AI][Provider startup]', {stage:safeStage,errorType:error?.name??'Error'});
    root.innerHTML=renderProviderStartupError(safeStage);
    root.querySelector('[data-provider-reload]')?.addEventListener('click',()=>globalThis.location?.reload());
    return null;
  }
}

if(typeof document!=='undefined') { void bootstrapProviderApp(document.querySelector('#provider-root')); if('serviceWorker' in navigator) navigator.serviceWorker.register('./provider-sw.js').catch(()=>{}); }
