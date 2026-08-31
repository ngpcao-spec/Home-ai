const quoteDetailsByCategory = {
  electricity: {
    recommendedWork: 'Kiểm tra mạch điện, thay ổ cắm bị hỏng và kiểm tra an toàn sau sửa chữa.',
    partsAmount: 120000,
    estimatedMinutes: 45,
  },
  plumbing: {
    recommendedWork: 'Kiểm tra điểm rò rỉ, thay vật tư hỏng và thử kín đường nước.',
    partsAmount: 100000,
    estimatedMinutes: 50,
  },
  'air-conditioning': {
    recommendedWork: 'Kiểm tra hệ thống làm lạnh, xử lý bộ phận lỗi và chạy thử thiết bị.',
    partsAmount: 180000,
    estimatedMinutes: 60,
  },
  appliances: {
    recommendedWork: 'Kiểm tra thiết bị, thay bộ phận hỏng và chạy thử an toàn.',
    partsAmount: 150000,
    estimatedMinutes: 60,
  },
};

export function createInterventionQuote(diagnosis, technician) {
  const details = quoteDetailsByCategory[technician.category] ?? quoteDetailsByCategory.appliances;
  const laborAmount = technician.priceFrom;
  return {
    diagnosis: diagnosis.summary,
    recommendedWork: details.recommendedWork,
    laborAmount,
    partsAmount: details.partsAmount,
    totalAmount: laborAmount + details.partsAmount,
    estimatedMinutes: details.estimatedMinutes,
    warrantyDays: 30,
  };
}
