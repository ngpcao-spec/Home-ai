const assignedStatuses = new Set(['accepted', 'travelling', 'arrived', 'quote_pending', 'supplement_pending', 'in_progress', 'completed_pending_payment', 'completed']);

export function getCustomerDispatchState({ mission, offers = [] }) {
  if (mission.providerId && assignedStatuses.has(mission.status)) {
    return { phase: 'accepted', title: 'Đã kết nối thành công' };
  }
  if (['cancelled', 'expired'].includes(mission.status)) {
    return { phase: 'closed', title: 'Yêu cầu đã kết thúc' };
  }
  if (offers.some(offer => offer.status === 'pending')) {
    return { phase: 'waiting', title: 'Đang chờ thợ xác nhận...' };
  }
  return { phase: 'searching', title: 'Đang tìm thợ phù hợp tiếp theo...' };
}

export function renderCustomerDispatchState(snapshot) {
  const { phase, title } = getCustomerDispatchState(snapshot);
  return `<article class="map-bottom-sheet" data-dispatch-state="${phase}" role="status"><h2>${title}</h2></article>`;
}
