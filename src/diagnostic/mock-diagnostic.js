const CATEGORY_RULES = [
  {
    id: 'air-conditioning',
    keywords: ['máy lạnh', 'điều hòa', 'điều hoà', 'dieu hoa', 'air conditioner', 'không lạnh', 'khong lanh'],
  },
  {
    id: 'plumbing',
    keywords: ['vòi', 'nước', 'rò', 'ống', 'bồn cầu', 'thoát nước'],
  },
  {
    id: 'appliances',
    keywords: ['tủ lạnh', 'máy giặt', 'lò vi sóng', 'bếp điện', 'thiết bị', 'gia dụng'],
  },
  {
    id: 'electricity',
    keywords: ['điện', 'ổ cắm', 'ổ điện', 'cầu dao', 'mất điện', 'chập', 'đèn'],
  },
];

const noCoolingAirConditionerDiagnostic = {
  summary: 'Điều hòa không lạnh',
  finding: 'Tụ điện máy nén hoạt động không ổn định và cần thay thế.',
  recommendedTasks: [
    'Thay tụ điện máy nén',
    'Kiểm tra hệ thống',
    'Vệ sinh cơ bản',
  ],
};

const withoutVietnameseAccents = (value) => value
  .toLocaleLowerCase('vi')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replaceAll('đ', 'd');

export function detectCategory(description, preferredCategory) {
  const normalizedDescription = description.toLocaleLowerCase('vi');
  const match = CATEGORY_RULES.find(({ keywords }) => (
    keywords.some((keyword) => normalizedDescription.includes(keyword))
  ));

  return match?.id ?? preferredCategory ?? 'appliances';
}

export function createMockDiagnostic({ delay = 650 } = {}) {
  return {
    async analyse({ description, preferredCategory }) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

      const categoryId = detectCategory(description, preferredCategory);
      const isNoCoolingAirConditioner = categoryId === 'air-conditioning'
        && withoutVietnameseAccents(description).includes('dieu hoa khong lanh');
      return {
        categoryId,
        summary: description.trim(),
        ...(isNoCoolingAirConditioner ? noCoolingAirConditionerDiagnostic : {}),
      };
    },
  };
}
