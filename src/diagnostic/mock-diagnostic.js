const CATEGORY_RULES = [
  {
    id: 'air-conditioning',
    keywords: ['máy lạnh', 'điều hòa', 'điều hoà', 'air conditioner', 'không lạnh'],
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

      return {
        categoryId: detectCategory(description, preferredCategory),
        summary: description.trim(),
      };
    },
  };
}
