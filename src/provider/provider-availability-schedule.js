const DAYS = Object.freeze([
  ['1', 'Thứ Hai'], ['2', 'Thứ Ba'], ['3', 'Thứ Tư'], ['4', 'Thứ Năm'],
  ['5', 'Thứ Sáu'], ['6', 'Thứ Bảy'], ['0', 'Chủ Nhật'],
]);
const esc = (value = '') => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const slotsByDay = (schedule = []) => new Map(schedule.map(slot => [String(slot.day), slot]));

export function renderProviderAvailabilitySchedule(preferences, { loading = false, error = '', message = '', busy = false } = {}) {
  if (loading) return '<section class="provider-availability"><p class="pricing-kicker">TRẠNG THÁI</p><h1>Lịch nhận việc</h1><div class="empty">Đang tải lịch…</div></section>';
  if (error) return `<section class="provider-availability"><p class="pricing-kicker">TRẠNG THÁI</p><h1>Lịch nhận việc</h1><div class="history-error" role="alert">Không thể tải lịch nhận việc.<small>${esc(error)}</small><button data-availability-retry>Thử lại</button></div></section>`;
  const mode = preferences?.mode === 'scheduled' ? 'scheduled' : 'manual';
  const available24h = Boolean(preferences?.available24h);
  const slots = slotsByDay(preferences?.weeklySchedule);
  return `<section class="provider-availability">
    <p class="pricing-kicker">TRẠNG THÁI</p><h1>Lịch nhận việc</h1>
    <p>Bạn luôn cần bật trạng thái Trực tuyến để nhận nhiệm vụ.</p>
    <form class="availability-card" data-availability-form>
      <label class="availability-mode"><input type="radio" name="availability-mode" value="manual" ${mode === 'manual' ? 'checked' : ''}><span><strong>Thủ công</strong><small>Chỉ dùng nút Trực tuyến / Ngoại tuyến.</small></span></label>
      <label class="availability-mode"><input type="radio" name="availability-mode" value="scheduled" ${mode === 'scheduled' ? 'checked' : ''}><span><strong>Theo lịch + Trực tuyến</strong><small>Chỉ nhận việc trong lịch khi đang trực tuyến.</small></span></label>
      <div class="availability-schedule" data-availability-schedule ${mode === 'scheduled' ? '' : 'hidden'}>
        <label class="availability-24h"><input type="checkbox" data-availability-24h ${available24h ? 'checked' : ''}><span>Sẵn sàng 24/24</span></label>
        <div data-availability-days ${available24h ? 'hidden' : ''}>
          ${DAYS.map(([day, label]) => { const slot = slots.get(day); return `<div class="availability-day">
            <label><input type="checkbox" data-availability-day="${day}" ${slot ? 'checked' : ''}><span>${label}</span></label>
            <div><input type="time" data-availability-start="${day}" value="${esc(slot?.start ?? '08:00')}" ${slot ? '' : 'disabled'} aria-label="Bắt đầu ${label}"><span>–</span><input type="time" data-availability-end="${day}" value="${esc(slot?.end ?? '18:00')}" ${slot ? '' : 'disabled'} aria-label="Kết thúc ${label}"></div>
          </div>`; }).join('')}
        </div>
      </div>
      <button type="submit" data-save-availability ${busy ? 'disabled' : ''}>Lưu lịch nhận việc</button>
    </form><p class="app-message" role="status">${esc(message)}</p>
  </section>`;
}

export function syncProviderAvailabilityScheduleForm(root) {
  const form = root.querySelector('[data-availability-form]');
  if (!form) return;
  const scheduled = form.querySelector('[name="availability-mode"]:checked')?.value === 'scheduled';
  const available24h = Boolean(form.querySelector('[data-availability-24h]')?.checked);
  form.querySelector('[data-availability-schedule]')?.toggleAttribute('hidden', !scheduled);
  form.querySelector('[data-availability-days]')?.toggleAttribute('hidden', available24h);
  for (const checkbox of form.querySelectorAll('[data-availability-day]')) {
    const day = checkbox.dataset.availabilityDay;
    for (const input of form.querySelectorAll(`[data-availability-start="${day}"],[data-availability-end="${day}"]`)) input.disabled = !checkbox.checked;
  }
}

export function readProviderAvailabilitySchedule(root) {
  const form = root.querySelector('[data-availability-form]');
  const mode = form?.querySelector('[name="availability-mode"]:checked')?.value;
  const available24h = Boolean(form?.querySelector('[data-availability-24h]')?.checked);
  const weeklySchedule = [...(form?.querySelectorAll('[data-availability-day]:checked') ?? [])].map(checkbox => {
    const day = Number(checkbox.dataset.availabilityDay);
    return { day, start: form.querySelector(`[data-availability-start="${day}"]`)?.value ?? '', end: form.querySelector(`[data-availability-end="${day}"]`)?.value ?? '' };
  });
  const timesValid = weeklySchedule.every(slot => /^\d{2}:\d{2}$/.test(slot.start) && /^\d{2}:\d{2}$/.test(slot.end) && slot.start !== slot.end);
  const valid = ['manual', 'scheduled'].includes(mode) && timesValid
    && (mode === 'manual' || available24h || weeklySchedule.length > 0);
  return Object.freeze({ mode, available24h, weeklySchedule: Object.freeze(weeklySchedule), valid });
}

export { DAYS as PROVIDER_AVAILABILITY_DAYS };
