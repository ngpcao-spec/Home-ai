import { getProviderActivityLabel } from '../provider/provider-activities.js';

const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const adminActiveStatuses = Object.freeze(['requested','searching','offered','accepted','travelling','arrived','quote_pending','in_progress','supplement_pending','completed_pending_payment']);
const labels = { requested: 'Đã gửi yêu cầu', searching: 'Đang tìm thợ', offered: 'Đang chờ thợ xác nhận', accepted: 'Thợ đã nhận yêu cầu', travelling: 'Đang di chuyển', arrived: 'Thợ đã đến', quote_pending: 'Đang chờ duyệt báo giá', in_progress: 'Đang thực hiện', supplement_pending: 'Đang chờ duyệt bổ sung', completed_pending_payment: 'Chờ xác nhận thanh toán', completed: 'Hoàn thành', cancelled: 'Đã hủy', expired: 'Hết hạn' };
const payment = { unpaid: 'Chưa xác nhận thanh toán', paid_external: 'Đã xác nhận thanh toán trực tiếp' };
const eventLabels = { 'mission.created': 'Yêu cầu', 'mission.offer.accepted': 'Thợ đã nhận yêu cầu', 'mission.provider.travelling': 'Đang di chuyển', 'mission.provider.arrived': 'Đã đến', 'mission.intervention.started': 'Bắt đầu công việc', 'mission.intervention.finished': 'Hoàn tất công việc', 'mission.invoice.submitted': 'Hoàn tất và gửi hóa đơn', 'mission.completed.external_payment': 'Xác nhận thanh toán', 'mission.cancelled': 'Đã hủy' };
const filters = { all: 'Tất cả', active: 'Đang hoạt động', completed: 'Hoàn thành', cancelled: 'Đã hủy' };
const service = (category, name) => getProviderActivityLabel({ serviceCategory: category,
  activityName: String(name ?? '').trim().toLowerCase() === String(category).toLowerCase() ? null : name });
const money = (amount, currency = 'VND') => amount == null ? 'Chưa có' : `${new Intl.NumberFormat('vi-VN').format(amount)}${currency === 'VND' ? 'đ' : ` ${esc(currency)}`}`;
const date = value => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value)) : '—';
const pair = (title, value) => `<div><dt>${title}</dt><dd>${value}</dd></div>`;

export function renderAdminMissionDetail(m) {
  const invoice = m.invoice;
  const quote = m.acceptedQuote;
  return `<button data-admin-back class="secondary">‹ Danh sách nhiệm vụ</button><article class="admin-detail"><h2>${esc(service(m.serviceCategory))}</h2><p class="admin-status">${labels[m.status] ?? 'Đang cập nhật'}</p><p>${esc(m.problem)}</p><dl>${pair('Khách hàng', esc(m.clientName ?? 'Chưa có'))}${pair('Thợ', esc(m.providerName ?? 'Chưa được phân công'))}${pair('Địa chỉ', esc(m.address ?? 'Chưa có'))}${pair('Tổng tiền cuối cùng', money(m.finalAmount, m.currency))}${pair('Thanh toán', payment[m.paymentStatus] ?? 'Chưa có xác nhận')}
    ${invoice ? pair('Thời gian khai báo', `${Math.floor(invoice.workedMinutes / 60)} giờ ${invoice.workedMinutes % 60} phút`) + pair('Đơn giá lịch sử', `${money(invoice.hourlyRate, m.currency)}/giờ`) + pair('Mức phí tối thiểu', money(invoice.minimumCharge, m.currency)) + pair('Tiền công', money(invoice.laborAmount, m.currency)) + pair('Vật tư', money(invoice.materialAmount, m.currency)) : ''}
    ${quote ? pair(`Báo giá V${quote.version} đã chấp nhận`, money(quote.totalAmount, m.currency)) + pair('Bảo hành', `${quote.warrantyDays} ngày`) : ''}</dl>
    <dl>${Object.entries(m.dates ?? {}).filter(([, value]) => value).map(([key, value]) => pair(({requested:'Yêu cầu',accepted:'Nhận việc',travelling:'Di chuyển',arrived:'Đến nơi',started:'Bắt đầu công việc',completed:'Hoàn thành / xác nhận thanh toán',cancelled:'Hủy'})[key] ?? 'Ngày', date(value))).join('')}</dl>
    <h3>Mốc thời gian</h3><ol class="admin-timeline">${(m.events ?? []).filter(event => eventLabels[event.type]).map(event => `<li><strong>${eventLabels[event.type]}</strong><time>${date(event.createdAt)}</time></li>`).join('') || '<li>Chưa có sự kiện.</li>'}</ol>
    ${m.review ? `<section><h3>Đánh giá</h3><p>${m.review.rating}/5 ★</p>${m.review.comment ? `<p>${esc(m.review.comment)}</p>` : ''}<time>${date(m.review.createdAt)}</time></section>` : ''}</article>`;
}

export function renderAdminMissionList(data, filter) {
  return `<div class="admin-filters">${Object.entries(filters).map(([key, label]) => `<button class="${filter === key ? '' : 'secondary'}" data-admin-filter="${key}" aria-pressed="${filter === key}">${label}</button>`).join('')}</div><section class="admin-list">${(data?.items ?? []).map(m => `<article><div><h2>${esc(service(m.serviceCategory))}</h2><span class="admin-status">${labels[m.status] ?? 'Đang cập nhật'}</span></div><p>${esc(m.clientName ?? 'Chưa có')} → ${esc(m.providerName ?? 'Chưa được phân công')}</p><p>${esc(m.address ?? 'Chưa có địa chỉ')}</p><time>${date(m.createdAt)}</time><strong>${money(m.finalAmount, m.currency)}</strong><button data-admin-mission="${esc(m.id)}">Xem chi tiết</button></article>`).join('') || '<p>Chưa có nhiệm vụ.</p>'}</section>`;
}

export function renderAdminProvider(p, repository, detail = false) {
  const avatar = repository.avatar(p.avatarPath);
  return `<article>${avatar ? `<img class="admin-avatar" src="${esc(avatar)}" alt="">` : ''}<h2>${esc(p.name)}</h2><p>${p.online ? 'Đang trực tuyến' : 'Ngoại tuyến'}${p.verified ? ' · ✓ Đã xác minh' : ''}</p><p>${esc(p.activities?.map(a => service(a.serviceCategory, a.name)).join(' · ') ?? '')}</p><p>${p.ratingAverage == null ? 'Chưa có đánh giá' : `${esc(p.ratingAverage)}/5 ★`} · ${esc(p.reviewCount ?? 0)} đánh giá · ${esc(p.completedJobs ?? 0)} nhiệm vụ hoàn thành</p>${detail ? `${p.experienceYears == null ? '' : `<p>${esc(p.experienceYears)} năm kinh nghiệm</p>`}${p.introduction ? `<p>${esc(p.introduction)}</p>` : ''}` : `<button data-admin-provider="${esc(p.id)}">Xem hồ sơ</button>`}</article>`;
}

export async function initialiseAdminSupervision(root, repository) {
  let view = 'missions'; let filter = 'all'; let offset = 0; let selected = null;
  let data = null; let error = false; let loading = true; let stopped = false; let revision = 0; let lastMarkup = ''; let timer;
  const draw = () => {
    if (stopped) return;
    const content = loading && !data ? '<p role="status">Đang tải…</p>' : error ? '<p role="alert">Không thể tải dữ liệu Admin. Vui lòng thử lại.</p>'
      : view === 'missions' ? selected ? renderAdminMissionDetail(data) : renderAdminMissionList(data, filter)
        : selected ? `<button data-admin-back class="secondary">‹ Danh sách thợ</button>${renderAdminProvider(data, repository, true)}`
          : `<section class="admin-list">${(data?.items ?? []).map(p => renderAdminProvider(p, repository)).join('') || '<p>Chưa có thợ.</p>'}</section>`;
    const markup = `<section class="admin-supervision" data-admin-state="authorized"><header><div class="brand"><img src="../provider-icon.svg" alt=""><strong>HOME <span>AI</span></strong></div><h1>HOME AI Admin</h1><nav><button data-admin-nav="missions" class="${view === 'missions' ? '' : 'secondary'}">Missions</button><button data-admin-nav="providers" class="${view === 'providers' ? '' : 'secondary'}">Providers</button><button data-admin-logout class="secondary">Déconnexion</button></nav></header><p class="admin-read-only">Chỉ xem · Không thể chỉnh sửa</p><button data-admin-refresh class="secondary">Làm mới</button>${content}${!selected && !error && !loading ? `<div class="admin-pages">${offset ? '<button data-admin-prev class="secondary">‹ Trước</button>' : ''}${data?.hasMore ? '<button data-admin-next class="secondary">Tiếp ›</button>' : ''}</div>` : ''}</section>`;
    if (markup !== lastMarkup) { root.innerHTML = markup; lastMarkup = markup; }
  };
  const load = async (showLoading = true) => {
    const current = ++revision; loading = showLoading; error = false; draw();
    try {
      const next = view === 'missions' ? selected ? await repository.mission(selected) : await repository.missions(filter, offset)
        : selected ? await repository.provider(selected) : await repository.providers(offset);
      if (stopped || current !== revision) return;
      data = next;
    } catch (failure) {
      if (stopped || current !== revision) return;
      data = null; error = true;
      if (failure.code === '42501') {
        stop();
        root.innerHTML = '<section class="admin-card" data-admin-state="denied"><h1>HOME AI Admin</h1><p>Accès refusé</p><button data-admin-logout>Déconnexion</button></section>';
        return;
      }
    }
    if (current === revision) { loading = false; draw(); }
  };
  const click = async (event) => {
    const button = event.target.closest('button'); if (!button || stopped) return;
    if (button.hasAttribute('data-admin-refresh')) { await load(false); return; }
    if (button.dataset.adminNav) { view = button.dataset.adminNav; selected = null; offset = 0; }
    else if (button.dataset.adminFilter) { filter = button.dataset.adminFilter; selected = null; offset = 0; }
    else if (button.dataset.adminMission) selected = button.dataset.adminMission;
    else if (button.dataset.adminProvider) selected = button.dataset.adminProvider;
    else if (button.hasAttribute('data-admin-back')) selected = null;
    else if (button.hasAttribute('data-admin-next')) offset += 50;
    else if (button.hasAttribute('data-admin-prev')) offset = Math.max(0, offset - 50);
    else return;
    data = null; await load();
  };
  let unsubscribe;
  const stop = () => { stopped = true; revision += 1; clearTimeout(timer); unsubscribe?.(); root.removeEventListener('click', click); };
  root.addEventListener('click', click);
  unsubscribe = repository.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!stopped) void load(false); }, 150);
  });
  await load();
  return { stop };
}
