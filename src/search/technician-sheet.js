import { getMatchReasons } from '../technicians/matching.js';

const formatPrice = (price) => new Intl.NumberFormat('vi-VN').format(price);

export function createTechnicianSheetMarkup(technician) {
  const reasons = getMatchReasons(technician).map((reason) => `<li>${reason}</li>`).join('');
  return `<article class="map-bottom-sheet" data-selected-technician="${technician.id}">
    <p class="sheet-eyebrow">ĐÃ KẾT NỐI THÀNH CÔNG</p><h2>Đã tìm thấy thợ phù hợp</h2>
    <div class="sheet-technician"><span class="technician-avatar">${technician.initials}</span><div><h3>${technician.name}</h3>${technician.verified ? '<span class="verified-badge">✓ Đã xác minh</span>' : ''}</div><strong>⭐ ${technician.rating}</strong></div>
    <p class="technician-description">${technician.shortDescription}</p>
    <div class="sheet-facts"><span>Dịch vụ: ${technician.categoryLabel ?? technician.category}</span><span>${technician.completedJobs} việc đã hoàn thành</span><span>Độ tin cậy ${technician.reliabilityScore ?? 95}%</span><span>${technician.distanceKm.toFixed(1)} km đường bộ</span><span>Khoảng ${technician.estimatedArrivalMinutes} phút</span><span>Giá tham khảo ${formatPrice(technician.indicativePrice ?? technician.priceFrom)}đ</span></div>
    <div class="match-reasons"><strong>Vì sao HOME AI đề xuất thợ này?</strong><ul>${reasons}</ul></div>
    <div class="sheet-actions"><button type="button" data-choose-map-technician>Chọn thợ này</button><button type="button" data-next-technician>Tìm thợ khác</button><button type="button" data-view-profile="${technician.id}">Xem hồ sơ</button></div>
  </article>`;
}

export function createNoTechnicianMarkup() {
  return `<article class="map-bottom-sheet map-empty"><h2>Hiện chưa có thợ phù hợp gần bạn</h2><p>Bạn có thể thử tìm lại hoặc đặt lịch cho thời gian khác.</p><div class="sheet-actions"><button type="button" data-retry-search>Thử lại</button><button type="button" data-book-later>Đặt lịch sau</button></div></article>`;
}
