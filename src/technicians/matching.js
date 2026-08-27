const isImmediatelyAvailable = ({ availability }) => availability === 'Đang sẵn sàng';

// Thứ tự tiêu chí được giữ tách biệt với giao diện để có thể dùng lại khi chuyển sang API.
export function rankTechnicians(technicians, categoryId) {
  return technicians
    .filter(({ category }) => category === categoryId)
    .toSorted((a, b) =>
      Number(b.verified) - Number(a.verified)
      || Number(isImmediatelyAvailable(b)) - Number(isImmediatelyAvailable(a))
      || a.distanceKm - b.distanceKm
      || b.rating - a.rating
      || b.completedJobs - a.completedJobs
      || a.id.localeCompare(b.id),
    );
}

export function findBestTechnicians(technicians, categoryId, limit = 3) {
  return rankTechnicians(technicians, categoryId).slice(0, limit);
}

export function getMatchReasons(technician) {
  const reasons = [];
  if (technician.distanceKm <= 2.5) reasons.push('Gần bạn');
  if (technician.rating >= 4.8) reasons.push('Đánh giá cao');
  if (isImmediatelyAvailable(technician)) reasons.push('Đang sẵn sàng');
  if (technician.completedJobs >= 200) reasons.push('Nhiều kinh nghiệm');
  return reasons.slice(0, 3);
}

