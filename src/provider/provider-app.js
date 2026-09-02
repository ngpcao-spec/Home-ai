import { createProgressiveProviderAppRepository } from './provider-repository.js';

const labels = { electricity:'Điện', plumbing:'Nước', 'air-conditioning':'Điều hòa', appliances:'Điện gia dụng' };
const esc = (v='') => String(v).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
export function renderProviderDashboard(state, { source='mock', busy=false, message='' }={}) {
  const offers = state.offers ?? [];
  const assignment = state.assignment;
  return `<header class="provider-header"><div class="brand"><span>H</span><div><strong>HOME AI</strong><small>Đối tác kỹ thuật</small></div></div><button class="avatar" aria-label="Tài khoản">${esc(state.provider?.name?.split(' ').at(-1)?.[0] ?? 'P')}</button></header>
  <main><section class="welcome"><div><p>Xin chào,</p><h1>${esc(state.provider?.name ?? 'Kỹ thuật viên')}</h1><span class="verified">✓ Đã xác minh</span></div><span class="source">${source==='supabase'?'Đã kết nối':'Chế độ demo'}</span></section>
  <section class="status-card"><div><p>Trạng thái hoạt động</p><strong>${state.status?.online?'Đang trực tuyến':'Đang ngoại tuyến'}</strong></div><button class="switch ${state.status?.online?'on':''}" data-toggle-online aria-pressed="${Boolean(state.status?.online)}"><span></span></button><label><input type="checkbox" data-toggle-available ${state.status?.available?'checked':''} ${!state.status?.online||assignment?'disabled':''}> Sẵn sàng nhận việc</label></section>
  ${assignment?`<section class="assignment"><p>NHIỆM VỤ ĐANG THỰC HIỆN</p><h2>${esc(labels[assignment.serviceCategory]??assignment.serviceCategory)}</h2><strong>${esc(assignment.address)}</strong><p>${esc(assignment.request)}</p><span>● Đã nhận nhiệm vụ</span></section>`:''}
  <section class="offers"><div class="section-title"><div><p>CƠ HỘI GẦN BẠN</p><h2>Đề nghị nhiệm vụ</h2></div><span>${offers.length}</span></div>${offers.length?offers.map(o=>`<article class="offer-card"><div class="offer-top"><span class="service-icon">${o.serviceCategory==='electricity'?'⚡':'🛠'}</span><div><h3>${esc(labels[o.serviceCategory]??o.serviceCategory)}</h3><p>${esc(o.approximateAddress)}</p></div><strong>${Number(o.distanceKm).toFixed(1)} km</strong></div><p class="request">${esc(o.request)}</p><div class="facts"><span>◷ ${o.etaMinutes} phút</span><span>⌖ Địa chỉ gần đúng</span></div><div class="actions"><button data-decline="${esc(o.id)}" ${busy?'disabled':''}>Từ chối</button><button data-accept="${esc(o.id)}" ${busy||assignment?'disabled':''}>Chấp nhận</button></div></article>`).join(''):`<div class="empty">Không có đề nghị mới.<small>Hãy duy trì trạng thái trực tuyến để nhận việc.</small></div>`}</section><p class="app-message" role="status">${esc(message)}</p></main>
  <nav><button class="active">⌂<span>Trang chủ</span></button><button>▤<span>Nhiệm vụ</span></button><button>◎<span>Thu nhập</span></button><button>○<span>Hồ sơ</span></button></nav>`;
}

export async function initialiseProviderApp(root, repositoryLoader=createProgressiveProviderAppRepository) {
  let repository=await repositoryLoader(); let state=await repository.load(); let busy=false; let message='';
  const draw=()=>{root.innerHTML=renderProviderDashboard(state,{source:repository.source,busy,message});}; draw();
  root.addEventListener('click',async e=>{const online=e.target.closest('[data-toggle-online]');const accept=e.target.closest('[data-accept]');const decline=e.target.closest('[data-decline]');if(!online&&!accept&&!decline)return;busy=true;draw();try{if(online){const next=!state.status.online;state=await repository.setAvailability({online:next,available:next&&state.status.available});}if(accept)state=await repository.accept(accept.dataset.accept);if(decline)state=await repository.decline(decline.dataset.decline);message='Đã cập nhật thành công.';}catch{message='Không thể cập nhật. Vui lòng thử lại.';}finally{busy=false;draw();}});
  root.addEventListener('change',async e=>{if(!e.target.matches('[data-toggle-available]'))return;busy=true;draw();try{state=await repository.setAvailability({online:state.status.online,available:e.target.checked});message='Đã cập nhật khả dụng.';}catch{message='Không thể cập nhật.';}finally{busy=false;draw();}});
  return {getState:()=>structuredClone(state)};
}

if(typeof document!=='undefined') { initialiseProviderApp(document.querySelector('#provider-root')); if('serviceWorker' in navigator) navigator.serviceWorker.register('./provider-sw.js').catch(()=>{}); }
