import { renderSupplementForm, readSupplementForm, updateSupplementForm } from './supplement-form.js';
import { createProgressiveProviderAppRepository } from './provider-repository.js';
import { prepareProviderNavigation, renderProviderNavigation } from './provider-navigation.js';
import { createProviderGoogleAuth } from './provider-auth.js';
import { createProviderLocationHeartbeat } from './provider-location-heartbeat.js';
import { classifyGeolocationError, getLocationPermissionState, mountLocationPermissionGate, requestCurrentPosition } from '../location/location-permission.js';
import { createIncomingOfferLayer, createProviderDispatchController, createProviderOfferAlert, renderIncomingOffer, updateDispatchCountdown } from './provider-dispatch.js';
import { prepareProviderHistory, renderProviderIncome, renderProviderMissionHistory } from './provider-history.js';
import { readInitialQuoteForm, renderInitialQuoteForm, updateInitialQuoteForm } from './initial-quote-form.js';
import { readHourlyInvoiceForm, renderHourlyInvoiceForm, updateHourlyInvoiceForm } from './hourly-invoice-form.js';
import { readProviderPricingForm, renderProviderPricing } from './provider-pricing.js';
import { readProviderActivityInput, readProviderActivityPricing, renderProviderActivities } from './provider-activities.js';

function ensureDispatchStyles(documentRef = globalThis.document) {
  if (!documentRef?.head || documentRef.querySelector?.('[data-provider-dispatch-styles]')) return;
  const link = documentRef.createElement('link');
  link.rel = 'stylesheet';
  link.href = '../src/provider/provider-dispatch.css';
  link.dataset.providerDispatchStyles = '';
  documentRef.head.append(link);
}

const labels = { electricity:'Điện', plumbing:'Nước', 'air-conditioning':'Điều hòa', appliances:'Điện gia dụng' };
const esc = (v='') => String(v).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const money = (value) => `${new Intl.NumberFormat('vi-VN').format(value ?? 0)}đ`;
const statusLabel = { accepted:'Đã nhận nhiệm vụ', travelling:'Đang di chuyển', arrived:'Đã đến nơi', quote_pending:'Báo giá đã được chấp nhận', supplement_pending:'Đang chờ duyệt bổ sung', in_progress:'Đang thực hiện', completed_pending_payment:'Đã hoàn tất · chờ thanh toán' };
const serviceIcon = category => category==='electricity'?'⚡':'🛠';
// TODO(PILOT-BLOCKER): remove the GitHub Pages arrival bypass and its runtime
// configuration before onboarding any real provider.
const TEST_ARRIVAL_PROVIDER_ID='2040840f-10c6-4acf-a800-1640e1520f4b';
const TEST_ARRIVAL_PROVIDER_NAME='Provider Test Nha Trang';
export const isProviderTestArrivalEnabled=(runtimeConfig,provider)=>runtimeConfig?.PROVIDER_TEST_MODE===true
  && runtimeConfig?.PROVIDER_TEST_PROVIDER_ID===TEST_ARRIVAL_PROVIDER_ID
  && provider?.id===TEST_ARRIVAL_PROVIDER_ID
  && provider?.name===TEST_ARRIVAL_PROVIDER_NAME;
function renderQuoteWorkflow(assignment, { diagnosing=false, busy=false, supplementParent=null, billing=false }={}) {
  if (assignment.status === 'completed_pending_payment') {
    const finalAmount = assignment.finalAuthorizedAmount ?? assignment.quote?.totalAmount;
    return `<section class="provider-completion-waiting" data-provider-completion-waiting>
      <span class="completion-check" aria-hidden="true">✓</span>
      <p>HOÀN THÀNH CÔNG VIỆC</p>
      <h2>Công việc đã hoàn thành</h2>
      ${finalAmount != null ? `<div><small>Tổng tiền cuối cùng</small><strong>${money(finalAmount)}</strong></div>` : ''}
      <h3>Đang chờ khách hàng xác nhận thanh toán</h3>
      <small>Khách hàng cần xác nhận đã thanh toán trực tiếp trước khi nhiệm vụ được đóng.</small>
    </section>`;
  }
  if (billing) return renderHourlyInvoiceForm(assignment.pricing, { busy });
  if (assignment.pricing?.pricingModel === 'hourly') {
    if (assignment.status === 'arrived') return `<section class="provider-quote provider-hourly-start" data-hourly-intervention-ready>
      <p>THANH TOÁN THEO GIỜ</p><h3>Sẵn sàng bắt đầu công việc</h3>
      <div class="waiting-pulse">${money(assignment.pricing.hourlyRate)}/giờ · tối thiểu ${money(assignment.pricing.minimumCharge)}</div>
      <small>Thời gian và vật tư sẽ được khai báo khi hoàn thành công việc.</small>
      <button data-start-intervention ${busy?'disabled':''}>Bắt đầu thực hiện</button>
    </section>`;
    if (assignment.status === 'in_progress') return `<section class="provider-quote provider-hourly-progress" data-hourly-intervention-progress>
      <p>THANH TOÁN THEO GIỜ</p><h3>Công việc đang thực hiện</h3>
      <small>Hoàn thành công việc để khai báo thời gian và vật tư thực tế.</small>
      <button data-finish-intervention ${busy?'disabled':''}>Hoàn tất công việc</button>
    </section>`;
    return '';
  }
  if(supplementParent)return renderSupplementForm(supplementParent);
  if (assignment.quote && !['declined','rejected'].includes(assignment.quote.status)) { const accepted=assignment.quote.status==='accepted'; return `<section class="provider-quote provider-quote--waiting"><p>BÁO GIÁ V${assignment.quote.version}</p><h3>${esc(assignment.quote.diagnosis)}</h3><strong>${money(assignment.quote.totalAmount)}</strong><span>${accepted?'Khách hàng đã chấp nhận':'Đã gửi cho khách hàng'}</span><div class="waiting-pulse">${accepted?'✓ Công việc đã được phê duyệt':'⌛ Đang chờ khách hàng chấp nhận'}</div><small>${accepted?'Nội dung báo giá này đã khóa; mọi thay đổi phải tạo phiên bản mới.':'Không bắt đầu công việc tính phí trước khi khách hàng chấp nhận rõ ràng.'}</small>${accepted&&assignment.status==='quote_pending'?`<button data-start-intervention ${busy?'disabled':''}>Bắt đầu thực hiện</button>`:''}${assignment.status==='in_progress'?`<button data-provider-supplement>Đề xuất chi phí phát sinh</button><button data-finish-intervention ${busy?'disabled':''}>Hoàn tất công việc</button>`:''}</section>`; }
  if (assignment.status === 'in_progress' && assignment.quote?.status === 'rejected') return '<p>Chi phí phát sinh đã bị từ chối. Chỉ tiếp tục công việc đã chấp nhận.</p><button data-finish-intervention>Hoàn tất công việc</button>';
  if (assignment.status !== 'arrived') return '';
  if (!diagnosing) return `<button class="diagnosis-start" data-start-diagnosis ${busy?'disabled':''}>Bắt đầu chẩn đoán</button>`;
  return renderInitialQuoteForm({ busy });
}
export function renderActiveProviderMission(assignment,{busy=false,message='',navigation=null,navigationLoading=false,navigationError='',diagnosing=false,supplementParent=null,billing=false,testMode=false}={}){
  const route=navigation?.route;const destination=navigation?.destination;
  const mapHref=Number.isFinite(destination?.latitude)&&Number.isFinite(destination?.longitude)?`https://maps.apple.com/?daddr=${encodeURIComponent(destination.latitude)},${encodeURIComponent(destination.longitude)}`:null;
  const acceptedAmount=assignment.quote?.status==='accepted'?assignment.quote.totalAmount:assignment.finalAuthorizedAmount;
  const indicativeAmount=acceptedAmount??assignment.indicativeAmount;
  const priceLabel=acceptedAmount!=null?'Giá đã chấp nhận':'Giá tham khảo';
  /* PROVIDER_TEST_UI_START */
  const testArrivalMarkup=testMode?`<button class="test-arrival" data-test-provider-arrival ${busy?'disabled':''}>TEST — Giả lập đã đến</button>`:'';
  /* PROVIDER_TEST_UI_END */
  const showRoute=['accepted','travelling'].includes(assignment.status);
  return `<main class="active-mission"><div class="mission-title"><span></span><h1>Chi tiết nhiệm vụ</h1><span class="mission-status">${esc(statusLabel[assignment.status]??assignment.status)}</span></div>
    ${showRoute?`<section class="mission-map-card"><div class="provider-map" data-provider-map aria-label="Bản đồ đường đến khách hàng"></div>${navigation?`<div class="map-metrics"><div><small>Vị trí của bạn</small><strong>${navigation.providerLocation.latitude.toFixed(5)}, ${navigation.providerLocation.longitude.toFixed(5)}</strong></div><div><strong>${Number(route.distanceKm).toFixed(1)} km</strong><span>ETA ${route.durationMinutes} phút</span></div>${mapHref?`<a href="${mapHref}" target="_blank" rel="noopener" data-open-provider-map>⌘ Mở bản đồ</a>`:''}</div>`:navigationError?`<div class="route-loading route-loading--error"><strong>Không thể tải chi tiết lộ trình.</strong><small>${esc(navigationError)}</small><button type="button" data-retry-provider-navigation>Thử lại</button></div>`:`<div class="route-loading">${navigationLoading?'Đang chuẩn bị lộ trình…':'Đang tải chi tiết nhiệm vụ…'}</div>`}</section>`:''}
    <section class="mission-detail-card"><div class="mission-service"><span>${serviceIcon(assignment.serviceCategory)}</span><div><small>Dịch vụ</small><h2>${esc(labels[assignment.serviceCategory]??assignment.serviceCategory)}</h2></div></div><div class="mission-detail-row"><small>Mô tả vấn đề</small><strong>${esc(assignment.request)}</strong></div><div class="mission-detail-row"><small>Địa chỉ</small><strong>${esc(assignment.address)}</strong></div>${route?`<div class="mission-trip"><div><small>Khoảng cách</small><strong>${Number(route.distanceKm).toFixed(1)} km</strong></div><div><small>Thời gian di chuyển</small><strong>${route.durationMinutes} phút</strong></div></div>`:''}${indicativeAmount!=null?`<div class="mission-price"><small>${priceLabel}</small><strong>${money(indicativeAmount)}</strong></div>`:''}</section>
    <div class="mission-actions">${assignment.status==='accepted'?`<button data-start-travel ${busy?'disabled':''}>BẮT ĐẦU DI CHUYỂN</button>`:''}${assignment.status==='travelling'?`<button data-mark-arrived ${busy||!navigation?.arrived?'disabled':''}>TÔI ĐÃ ĐẾN</button>${!navigation?.arrived?'<small>Nút được mở khi bạn ở trong phạm vi 150 m.</small>':''}${testArrivalMarkup}`:''}</div>${renderQuoteWorkflow(assignment,{diagnosing,busy,supplementParent,billing})}<p class="app-message" role="status">${esc(message)}</p></main>`;
}

export function renderProviderDashboard(state, { source='mock', busy=false, message='', navigation=null, navigationLoading=false, navigationError='', diagnosing=false, supplementParent=null, billing=false, testMode=false }={}) {
  const offers = state.offers ?? [];
  const assignment = state.assignment;
  const header=`<header class="provider-header"><div class="brand"><span>H</span><div><strong>HOME AI</strong><small>Đối tác kỹ thuật</small></div></div><button class="avatar" data-provider-logout aria-label="Đăng xuất">${esc(state.provider?.name?.split(' ').at(-1)?.[0] ?? 'P')}</button></header>`;
  if(assignment)return `${header}${renderActiveProviderMission(assignment,{busy,message,navigation,navigationLoading,navigationError,diagnosing,supplementParent,billing,testMode})}${renderProviderNav('home')}`;
  return `${header}
  <main><section class="welcome"><div><p>Xin chào,</p><h1>${esc(state.provider?.name ?? 'Kỹ thuật viên')}</h1><span class="verified">✓ Đã xác minh</span></div><span class="source">${source==='supabase'?'Đã kết nối':'Chế độ demo'}</span></section>
  <section class="status-card"><div><p>Trạng thái hoạt động</p><strong>${state.status?.online?'Đang trực tuyến':'Đang ngoại tuyến'}</strong></div><button class="switch ${state.status?.online?'on':''}" data-toggle-online aria-label="Đang trực tuyến" aria-pressed="${Boolean(state.status?.online)}" ${busy?'disabled':''}><span></span></button></section>
  <section class="offers"><div class="section-title"><div><p>CƠ HỘI GẦN BẠN</p><h2>Đề nghị nhiệm vụ</h2></div><span>${offers.length}</span></div>${offers.length?offers.map(o=>`<article class="offer-card"><div class="offer-top"><span class="service-icon">${o.serviceCategory==='electricity'?'⚡':'🛠'}</span><div><h3>${esc(labels[o.serviceCategory]??o.serviceCategory)}</h3><p>${esc(o.approximateAddress)}</p></div><strong>${Number(o.distanceKm).toFixed(1)} km</strong></div><p class="request">${esc(o.request)}</p><div class="facts"><span>◷ ${o.etaMinutes} phút</span><span>⌖ Địa chỉ gần đúng</span></div><div class="actions"><button data-decline="${esc(o.id)}" ${busy?'disabled':''}>Từ chối</button><button data-accept="${esc(o.id)}" ${busy||assignment?'disabled':''}>Chấp nhận</button></div></article>`).join(''):`<div class="empty">Không có đề nghị mới.<small>Hãy duy trì trạng thái trực tuyến để nhận việc.</small></div>`}</section><p class="app-message" role="status">${esc(message)}</p></main>
  ${renderProviderNav('home')}`;
}

function renderProviderNav(activeView) {
  return `<nav aria-label="Điều hướng Provider"><button data-provider-view="home" class="${activeView==='home'?'active':''}">⌂<span>Trang chủ</span></button><button data-provider-view="activities" class="${activeView==='activities'?'active':''}">▣<span>Hoạt động</span></button><button data-provider-view="missions" class="${activeView==='missions'?'active':''}">▤<span>Nhiệm vụ</span></button><button data-provider-view="income" class="${activeView==='income'?'active':''}">◎<span>Thu nhập</span></button><button data-provider-view="profile" class="${activeView==='profile'?'active':''}">○<span>Hồ sơ</span></button></nav>`;
}

export function renderProviderLogin({ error = '', provisioning = false } = {}) {
  return `<main class="provider-auth"><div class="brand"><span>H</span><div><strong>HOME AI</strong><small>Đối tác kỹ thuật</small></div></div><h1>${provisioning ? 'Tài khoản chưa được kích hoạt' : 'Đăng nhập đối tác'}</h1><p>${provisioning ? 'Tài khoản Google đã được xác thực. Quản trị viên HOME AI phải cấp vai trò provider, KYC và dịch vụ trước khi tiếp tục.' : 'Sử dụng tài khoản Google dành riêng cho kỹ thuật viên thử nghiệm.'}</p>${provisioning ? '<button data-provider-logout>Đăng xuất</button>' : '<button data-provider-google-login><strong>G</strong> Tiếp tục với Google</button>'}<p class="app-message" role="status">${esc(error)}</p></main>`;
}

export function renderProviderStartupError(safeStage = 'STARTUP') {
  return `<main class="provider-auth" data-provider-startup-error><div class="brand"><span>H</span><div><strong>HOME AI</strong><small>Đối tác kỹ thuật</small></div></div><h1>Không thể khởi động ứng dụng</h1><p>Vui lòng tải lại trang. Nếu lỗi vẫn còn, hãy cung cấp mã chẩn đoán bên dưới.</p><small data-provider-error-stage>Mã: ${esc(safeStage)}</small><button type="button" data-provider-reload>Tải lại</button></main>`;
}

export async function initialiseProviderApp(root, repositoryLoader=createProgressiveProviderAppRepository, navigationLoader=prepareProviderNavigation, auth=createProviderGoogleAuth(), heartbeatFactory=createProviderLocationHeartbeat, locationAccess={classifyError:classifyGeolocationError,getState:getLocationPermissionState,mount:mountLocationPermissionGate,request:requestCurrentPosition,geolocation:globalThis.navigator?.geolocation},runtimeConfig=globalThis.__HOME_AI_CONFIG__) {
  ensureDispatchStyles(root?.ownerDocument);
  let session;
  try{session=await auth.getSession();}catch(error){if(!error.safeStage)error.safeStage='AUTH_SESSION';throw error;}
  if(auth.enabled&&!session?.user){root.innerHTML=renderProviderLogin();root.addEventListener('click',async e=>{if(!e.target.closest('[data-provider-google-login]'))return;try{await auth.signIn();}catch{root.innerHTML=renderProviderLogin({error:'Không thể đăng nhập bằng Google. Vui lòng thử lại.'});}});return{getState:()=>null};}
  let repository;
  try{repository=await repositoryLoader();}catch{root.innerHTML=renderProviderLogin({provisioning:true});root.addEventListener('click',async e=>{if(e.target.closest('[data-provider-logout]')){await auth.signOut();globalThis.location?.reload();}});return{getState:()=>null};}
  let state;
  try{state=await repository.load();}catch(error){error.safeStage='DASHBOARD_LOAD';throw error;}
  const openDashboard=async()=>{
  let busy=false; let message=''; let navigation=null;let navigationLoading=false;let navigationError=''; let diagnosing=false; let editingMissionId=null; let supplementParent=null;let billingMissionId=null;let confirmingAcceptance=false;
  let currentView='home'; let history=[]; let historyLoading=false; let historyError=''; let selectedMissionId=null;
  let pricingServices=[];let pricingLoading=false;let pricingError='';let pricingMessage='';
  let activityFlow={step:'list',mode:null,input:'',proposal:null,reference:null,error:'',message:''};
  let priorityOfferId=repository.source==='supabase' ? state.offers?.[0]?.id ?? null : null;
  const page=root.ownerDocument??globalThis.document;
  const providerTestMode=isProviderTestArrivalEnabled(runtimeConfig,state.provider);
  const offerAlert=createProviderOfferAlert();
  offerAlert.prepare();
  const offerLayer=createIncomingOfferLayer(root);
  const updateAudioControl=()=>{
    const control=(offerLayer?.host??root).querySelector('[data-enable-offer-audio]');
    if(control){
      const error=offerAlert.getAudioError();
      control.hidden=!offerAlert.needsAudioActivation()&&!error;
      control.textContent=error?`Không thể phát âm thanh (${error}). Chạm để thử lại.`:'♫ Chạm để bật âm thanh';
    }
  };
  const syncOfferLayer=()=>{
    const offer=repository.source==='supabase'&&!page?.hidden&&!busy
      ? state.offers?.find(o=>(!o.status||o.status==='pending')&&new Date(o.expiresAt).getTime()>Date.now()) : null;
    priorityOfferId=offer?.id??null;
    offerLayer?.sync(offer);
    if(offer)offerAlert.start(offer);else offerAlert.stop();
    updateAudioControl();
    return offer;
  };
  const renderDashboard=async()=>{
    syncOfferLayer();
    if(currentView==='missions'||currentView==='income'){
      const content=currentView==='missions'?renderProviderMissionHistory(history,{loading:historyLoading,error:historyError,selectedMissionId}):renderProviderIncome(history,{loading:historyLoading,error:historyError});
      const priorityOffer=state.offers?.find(({id})=>id===priorityOfferId);
      root.innerHTML=`<header class="provider-header"><div class="brand"><span>H</span><div><strong>HOME AI</strong><small>Đối tác kỹ thuật</small></div></div><button class="avatar" data-provider-logout aria-label="Đăng xuất">${esc(state.provider?.name?.split(' ').at(-1)?.[0]??'P')}</button></header>${content}${renderProviderNav(currentView)}${offerLayer?'':renderIncomingOffer(priorityOffer)}`;
      return;
    }
    if(currentView==='profile'){
      root.innerHTML=`<header class="provider-header"><div class="brand"><span>H</span><div><strong>HOME AI</strong><small>Đối tác kỹ thuật</small></div></div><button class="avatar" data-provider-logout aria-label="Đăng xuất">${esc(state.provider?.name?.split(' ').at(-1)?.[0]??'P')}</button></header>${renderProviderPricing(pricingServices,{loading:pricingLoading,error:pricingError,message:pricingMessage,busy})}${renderProviderNav('profile')}`;
      return;
    }
    if(currentView==='activities'){
      root.innerHTML=`<header class="provider-header"><div class="brand"><span>H</span><div><strong>HOME AI</strong><small>Đối tác kỹ thuật</small></div></div><button class="avatar" data-provider-logout aria-label="Đăng xuất">${esc(state.provider?.name?.split(' ').at(-1)?.[0]??'P')}</button></header>${renderProviderActivities(pricingServices,{...activityFlow,busy})}${renderProviderNav('activities')}`;
      return;
    }
    const priorityOffer=state.offers?.find(({id})=>id===priorityOfferId);root.innerHTML=renderProviderDashboard(state,{source:repository.source,busy,message,navigation,navigationLoading,navigationError,diagnosing,supplementParent,billing:state.assignment?.id===billingMissionId,testMode:providerTestMode})+(offerLayer?'':renderIncomingOffer(priorityOffer));const map=root.querySelector('[data-provider-map]');if(navigation&&map)await renderProviderNavigation(map,navigation,state.provider).catch(()=>{});
  };
  const loadHistory=async()=>{historyLoading=true;historyError='';await renderDashboard();try{history=prepareProviderHistory(await repository.getHistory(),state.provider.id);}catch(error){history=[];historyError=error?.message??'Lỗi không xác định';}finally{historyLoading=false;await renderDashboard();}};
  const loadPricing=async()=>{pricingLoading=true;pricingError='';await renderDashboard();try{pricingServices=await repository.getServices();}catch(error){pricingServices=[];pricingError=error?.message??'Lỗi không xác định';}finally{pricingLoading=false;await renderDashboard();}};
  const canSendQuote=()=>state.assignment?.id===editingMissionId
    && state.assignment.status==='arrived'
    && state.assignment.pricing?.pricingModel!=='hourly'
    && (!state.assignment.quote || ['declined','rejected'].includes(state.assignment.quote.status));
  const canSendSupplement=()=>state.assignment?.id===editingMissionId
    && state.assignment?.status==='in_progress' && state.assignment.quote?.status==='accepted'
    && state.assignment.quote.id===supplementParent?.id;
  const canSendInvoice=()=>state.assignment?.id===billingMissionId
    && state.assignment.status==='in_progress' && state.assignment.pricing?.pricingModel==='hourly'
    && !state.assignment.invoice;
  const draw=async()=>{
    if(confirmingAcceptance)return;
    syncOfferLayer();
    if(supplementParent && root.querySelector('[data-supplement-form]')){
      updateSupplementForm(root,supplementParent,canSendSupplement(),busy);
      const notice=root.querySelector('.app-message');
      if(notice)notice.textContent=canSendSupplement()?message:'Nhiệm vụ đã thay đổi. Không thể gửi đề xuất này.';
      return;
    }
    // Preserve attached inputs, Safari focus, selection and IME composition.
    if(diagnosing && root.querySelector('[data-quote-diagnosis]')){
      updateInitialQuoteForm(root,canSendQuote(),busy);
      const notice=root.querySelector('.app-message');
      if(notice)notice.textContent=canSendQuote()?message:'Nhiệm vụ đã thay đổi. Không thể gửi báo giá này.';
      return;
    }
    if(billingMissionId && root.querySelector('[data-hourly-invoice-form]')){
      updateHourlyInvoiceForm(root,state.assignment?.pricing,canSendInvoice(),busy);
      const notice=root.querySelector('.app-message');
      if(notice)notice.textContent=canSendInvoice()?message:'Nhiệm vụ đã thay đổi. Không thể gửi hóa đơn này.';
      return;
    }
    await renderDashboard();
    if(supplementParent)updateSupplementForm(root,supplementParent,canSendSupplement(),busy);
    else if(diagnosing)updateInitialQuoteForm(root,canSendQuote(),busy);
  };
  const loadNavigation=async()=>{if(!['accepted','travelling'].includes(state.assignment?.status))return;navigationLoading=true;navigationError='';navigation=null;let timeoutId;try{navigation=await Promise.race([navigationLoader(state.assignment,{source:repository.source}),new Promise((_,reject)=>{timeoutId=globalThis.setTimeout(()=>reject(new Error('Hết thời gian chờ Amazon Location.')),12000);})]);}catch(error){navigationError=error?.message??'Không thể tải lộ trình.';message='Không thể tải lộ trình. GPS vẫn sẵn sàng để thử lại.';}finally{globalThis.clearTimeout?.(timeoutId);navigationLoading=false;}};
  await draw();if(['accepted','travelling'].includes(state.assignment?.status))void loadNavigation().then(draw);
  if(repository.source==='supabase'&&!page?.hidden)offerAlert.start(state.offers?.find(({id})=>id===priorityOfferId));
  const heartbeat=heartbeatFactory({repository,getState:()=>state,isPageActive:()=>!page?.hidden,onState:async next=>{state=next;syncOfferLayer();message='Vị trí GPS đã được cập nhật.';if(currentView==='home')await draw();},onError:async()=>{message='Không thể cập nhật GPS. Hãy cho phép truy cập vị trí.';if(currentView==='home')await draw();}});
  const dispatch=createProviderDispatchController({repository,getState:()=>state,isPageActive:()=>!page?.hidden,onState:async next=>{
    const previousAssignment=`${state.assignment?.id??''}:${state.assignment?.status??''}`;
    state=next; priorityOfferId=next.offers?.find(({expiresAt})=>new Date(expiresAt).getTime()>Date.now())?.id??null;
    const assignmentChanged=previousAssignment!==`${next.assignment?.id??''}:${next.assignment?.status??''}`;
    if(page?.hidden)return;
    if((currentView==='missions'||currentView==='income')&&assignmentChanged)await loadHistory();
    else if(currentView==='home')await draw();
  },onOffer:async offer=>{priorityOfferId=offer.id;if(page?.hidden)return;offerAlert.start(offer);if(!root.querySelector?.(`[data-dispatch-offer-id="${offer.id}"]`))await draw();},onError:async()=>{message='Kết nối thời gian thực bị gián đoạn. HOME AI đang thử lại.';if(currentView==='home'&&!page?.hidden)await draw();}});
  dispatch.start();
  const countdownTimer=globalThis.setInterval?.(()=>{const remaining=updateDispatchCountdown(offerLayer?.host??root);if(remaining===0&&priorityOfferId){const expiredId=priorityOfferId;priorityOfferId=null;offerAlert.stop(expiredId);void draw();}},1000);
  const syncHeartbeat=()=>{heartbeat.sync();syncOfferLayer();};
  page?.addEventListener?.('visibilitychange',syncHeartbeat);
  globalThis.addEventListener?.('pagehide',()=>{heartbeat.stop();dispatch.stop();globalThis.clearInterval?.(countdownTimer);},{once:true});
  heartbeat.sync();
  root.addEventListener('input',()=>{if(supplementParent)updateSupplementForm(root,supplementParent,canSendSupplement(),busy);else if(diagnosing)updateInitialQuoteForm(root,canSendQuote(),busy);else if(billingMissionId)updateHourlyInvoiceForm(root,state.assignment?.pricing,canSendInvoice(),busy);});
  const wait=milliseconds=>new Promise(resolve=>globalThis.setTimeout(resolve,milliseconds));
  const handleProviderClick=async e=>{
    if(e.target.closest('[data-enable-offer-audio]')){await offerAlert.unlock();updateAudioControl();return;}
    if(!e.target.closest('[data-accept]')&&!e.target.closest('[data-decline]'))void offerAlert.unlock().then(updateAudioControl);
    if(e.target.closest('[data-retry-provider-navigation]')){if(navigationLoading)return;void loadNavigation().then(draw);await draw();return;}
    const view=e.target.closest('[data-provider-view]');
    if(view){currentView=view.dataset.providerView;selectedMissionId=null;if(currentView==='missions'||currentView==='income')await loadHistory();else if(currentView==='profile'||currentView==='activities'){if(currentView==='activities')activityFlow={step:'list',mode:null,input:'',proposal:null,reference:null,error:'',message:''};await loadPricing();}else await draw();return;}
    const mission=e.target.closest('[data-history-mission]');if(mission){selectedMissionId=mission.dataset.historyMission;await draw();return;}
    if(e.target.closest('[data-history-back]')){selectedMissionId=null;await draw();return;}
    if(e.target.closest('[data-history-retry]')){await loadHistory();return;}
    if(e.target.closest('[data-pricing-retry]')){await loadPricing();return;}
    if(e.target.closest('[data-add-activity]')){activityFlow={step:'choose',mode:null,input:'',proposal:null,reference:null,error:'',message:''};await draw();return;}
    const activityBack=e.target.closest('[data-activity-back]');
    if(activityBack){activityFlow={...activityFlow,step:activityBack.dataset.activityBack,error:''};await draw();return;}
    const activityMode=e.target.closest('[data-activity-mode]');
    if(activityMode){activityFlow={...activityFlow,mode:activityMode.dataset.activityMode,input:'',error:''};await draw();return;}
    if(e.target.closest('[data-edit-activity]')){activityFlow={...activityFlow,step:'choose',error:''};await draw();return;}
    if(e.target.closest('[data-analyze-activity]')){
      e.preventDefault?.();if(busy)return;
      const input=readProviderActivityInput(root,activityFlow.mode);
      if(!input.valid){activityFlow={...activityFlow,error:'Vui lòng nhập ít nhất 2 ký tự.'};await draw();return;}
      busy=true;activityFlow={...activityFlow,input:input.text,error:''};await draw();
      try{const proposal=await repository.analyzeActivity(input);const reference=proposal.pricingModel==='hourly'?await repository.getHourlyRateReference(proposal.serviceCategory):{medianHourlyRate:null,providerCount:0};activityFlow={...activityFlow,step:'proposal',proposal,reference,error:''};}
      catch(error){activityFlow={...activityFlow,error:error?.message??'Không thể phân tích hoạt động.'};}
      finally{busy=false;await draw();}
      return;
    }
    if(e.target.closest('[data-activity-continue]')){if(activityFlow.proposal?.pricingModel!=='hourly')return;activityFlow={...activityFlow,step:'rate',error:''};await draw();return;}
    if(e.target.closest('[data-create-activity]')){
      e.preventDefault?.();if(busy||activityFlow.proposal?.pricingModel!=='hourly')return;
      const pricing=readProviderActivityPricing(root);
      if(!pricing.valid){activityFlow={...activityFlow,error:'Vui lòng nhập đơn giá và mức phí tối thiểu hợp lệ.'};await draw();return;}
      busy=true;activityFlow={...activityFlow,...pricing,error:''};await draw();
      try{await repository.createActivity(activityFlow.proposal,pricing);pricingServices=await repository.getServices();activityFlow={step:'list',mode:null,input:'',proposal:null,reference:null,error:'',message:'Đã thêm hoạt động.'};}
      catch(error){activityFlow={...activityFlow,error:error?.message??'Không thể thêm hoạt động.'};}
      finally{busy=false;await draw();}
      return;
    }
    const pricingForm=e.target.closest('[data-save-pricing]')?.closest('[data-pricing-service]');
    if(pricingForm){
      e.preventDefault?.();if(busy)return;
      const draft=readProviderPricingForm(pricingForm);
      if(!draft.valid){pricingMessage='Vui lòng nhập đơn giá và mức tối thiểu hợp lệ.';await draw();return;}
      busy=true;pricingMessage='';
      try{await repository.setServicePricing(draft.serviceCategory,draft);pricingServices=await repository.getServices();pricingMessage='Đã lưu giá dịch vụ.';}
      catch(error){pricingMessage=error?.message??'Không thể lưu giá dịch vụ.';}
      finally{busy=false;await draw();}
      return;
    }
    if(e.target.closest('[data-provider-supplement]')){
      if(busy || supplementParent || state.assignment?.status!=='in_progress' || state.assignment.quote?.status!=='accepted')return;
      editingMissionId=state.assignment.id; supplementParent=structuredClone(state.assignment.quote);
      await draw(); return;
    }
    if(e.target.closest('[data-cancel-supplement]')){
      if(busy)return;
      supplementParent=null; await draw(); return;
    }
    if(e.target.closest('[data-send-supplement]')){
      if(busy || !supplementParent || !canSendSupplement())return;
      const {draft,valid}=readSupplementForm(root,supplementParent);
      if(!valid)return;
      busy=true; await draw();
      try{
        state=await repository.createSupplement(editingMissionId,draft);
        supplementParent=null; message='Đã gửi đề xuất. Đang chờ khách hàng chấp nhận.';
      }catch{message='Không thể gửi đề xuất. Vui lòng thử lại.';}
      finally{busy=false; await draw();}
      return;
    }
    if(e.target.closest('[data-cancel-invoice]')){if(busy)return;billingMissionId=null;await draw();return;}
    if(e.target.closest('[data-send-invoice]')){
      if(busy||!canSendInvoice())return;
      const result=readHourlyInvoiceForm(root,state.assignment.pricing);
      if(!result.valid)return;
      busy=true;await draw();
      try{state=await repository.submitHourlyInvoice(billingMissionId,result.invoice);billingMissionId=null;message='Đã gửi hóa đơn cho khách hàng.';}
      catch(error){message=error?.message??'Không thể gửi hóa đơn. Vui lòng thử lại.';}
      finally{busy=false;heartbeat.sync();await draw();}
      return;
    }
    const logout=e.target.closest('[data-provider-logout]');const online=e.target.closest('[data-toggle-online]');const accept=e.target.closest('[data-accept]');const decline=e.target.closest('[data-decline]');const start=e.target.closest('[data-start-travel]');const arrived=e.target.closest('[data-mark-arrived]');const testArrival=e.target.closest('[data-test-provider-arrival]');const diagnose=e.target.closest('[data-start-diagnosis]');const send=e.target.closest('[data-send-quote]');const begin=e.target.closest('[data-start-intervention]');const finish=e.target.closest('[data-finish-intervention]');const supplement=e.target.closest('[data-provider-supplement]');if(logout){offerAlert.stop();heartbeat.stop();await auth.signOut();globalThis.location?.reload();return;}if(busy||(!online&&!accept&&!decline&&!start&&!arrived&&!testArrival&&!diagnose&&!send&&!begin&&!finish&&!supplement))return;if(diagnose){editingMissionId=state.assignment?.id;diagnosing=true;await draw();return;}if(finish){billingMissionId=state.assignment?.id;await draw();return;}let respondingOffer=null;if(accept||decline){respondingOffer=state.offers?.find(({id})=>id===(accept?.dataset.accept??decline?.dataset.decline));if(!respondingOffer||new Date(respondingOffer.expiresAt).getTime()<=Date.now()){priorityOfferId=null;offerAlert.stop();await draw();return;}offerAlert.stop(respondingOffer.id);}busy=true;await draw();try{if(online){const next=!state.status.online;state=await repository.setAvailability({online:next,available:next&&!state.assignment});}if(accept){state=await repository.accept(accept.dataset.accept);if(!state.assignment){state=await repository.load();if(!state.assignment)throw new Error('Mission acceptée introuvable.');}priorityOfferId=null;if(offerLayer){confirmingAcceptance=true;offerLayer.confirm();const navigationPromise=loadNavigation();await wait(1000);confirmingAcceptance=false;await draw();void navigationPromise.then(draw);}else void loadNavigation().then(draw);}if(decline){state=await repository.decline(decline.dataset.decline);priorityOfferId=null;}if(start||arrived){navigation=await navigationLoader(state.assignment,{source:repository.source});if(arrived&&!navigation.arrived)throw new Error('Provider not at destination');state=await repository.updateMissionProgress(state.assignment.id,start?'travelling':'arrived',navigation.providerLocation);}if(testArrival){if(!isProviderTestArrivalEnabled(runtimeConfig,state.provider)||state.assignment?.status!=='travelling'||!state.assignment.clientLocation)throw new Error('Provider test mode unavailable');state=await repository.updateMissionProgress(state.assignment.id,'arrived',state.assignment.clientLocation);navigation=null;}if(send){if(!canSendQuote())throw new Error('Mission is no longer ready for this quote');const {draft,valid}=readInitialQuoteForm(root);if(!valid)throw new Error('Invalid quote');state=await repository.createQuote(editingMissionId,draft);diagnosing=false;}if(begin)state=await repository.startIntervention(state.assignment.id);message='Đã cập nhật thành công.';}catch{confirmingAcceptance=false;message='Không thể cập nhật. Vui lòng thử lại.';if(respondingOffer&&new Date(respondingOffer.expiresAt).getTime()>Date.now()){priorityOfferId=respondingOffer.id;offerAlert.start(respondingOffer);}}finally{busy=false;heartbeat.sync();await draw();}};
  root.addEventListener('click',handleProviderClick);
  offerLayer?.host.addEventListener('click',handleProviderClick);
  return {getState:()=>structuredClone(state),stop:()=>{offerLayer?.stop();offerAlert.stop();heartbeat.stop();dispatch.stop();globalThis.clearInterval?.(countdownTimer);}};
  };
  if(repository.source==='supabase'){
    const savePosition=async position=>{state=await repository.updateLocation(position);};
    const showLocationGate=initialState=>locationAccess.mount(root,{initialState,geolocation:locationAccess.geolocation,onGranted:async position=>{await savePosition(position);return openDashboard();}});
    const permissionState=await locationAccess.getState({geolocation:locationAccess.geolocation});
    if(permissionState!=='granted')return showLocationGate(permissionState);
    try{await savePosition(await locationAccess.request(locationAccess.geolocation));}
    catch(error){return showLocationGate(locationAccess.classifyError(error));}
  }
  return openDashboard();
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

if(typeof document!=='undefined') {
  void bootstrapProviderApp(document.querySelector('#provider-root'));
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./provider-sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>{});
}
