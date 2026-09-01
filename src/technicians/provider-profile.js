const categoryProfiles = {
  electricity: {
    specialty: 'Kỹ thuật điện dân dụng',
    skills: ['Sửa chữa điện dân dụng', 'Kiểm tra an toàn điện', 'Lắp đặt thiết bị điện'],
  },
  plumbing: {
    specialty: 'Kỹ thuật cấp thoát nước',
    skills: ['Xử lý rò rỉ', 'Thông tắc đường ống', 'Lắp đặt thiết bị nước'],
  },
  'air-conditioning': {
    specialty: 'Kỹ thuật điều hòa',
    skills: ['Chẩn đoán điều hòa', 'Vệ sinh và bảo dưỡng', 'Thay thế linh kiện'],
  },
  appliances: {
    specialty: 'Kỹ thuật điện gia dụng',
    skills: ['Chẩn đoán thiết bị', 'Sửa chữa điện gia dụng', 'Thay thế linh kiện'],
  },
};

const profileOverrides = {
  'lanh-khoa': {
    experienceYears: 9,
    introduction: 'Tôi chuyên kiểm tra, bảo dưỡng và sửa chữa điều hòa dân dụng tại Nha Trang. Tôi luôn giải thích rõ nguyên nhân và chi phí trước khi bắt đầu công việc.',
    reviews: [
      { id: 'review-khoa-1', customerName: 'Minh Anh', rating: 5, comment: 'Thợ đến đúng giờ, kiểm tra kỹ và giải thích rất dễ hiểu.' },
      { id: 'review-khoa-2', customerName: 'Thu Hà', rating: 5, comment: 'Điều hòa hoạt động tốt sau khi sửa, làm việc sạch sẽ.' },
      { id: 'review-khoa-3', customerName: 'Quốc Bảo', rating: 5, comment: 'Tư vấn rõ ràng, thao tác nhanh và chuyên nghiệp.' },
    ],
  },
};

const defaultReviews = [
  { id: 'review-1', customerName: 'Ngọc Lan', rating: 5, comment: 'Kỹ thuật viên nhiệt tình, làm việc cẩn thận.' },
  { id: 'review-2', customerName: 'Anh Tuấn', rating: 5, comment: 'Đến đúng hẹn và giải thích công việc rõ ràng.' },
];

export function createProviderProfile(technician) {
  if (!technician?.id) throw new TypeError('A technician is required to create a ProviderProfile.');
  const category = categoryProfiles[technician.category] ?? {
    specialty: technician.categoryLabel ?? 'Kỹ thuật viên gia đình',
    skills: [],
  };
  const override = profileOverrides[technician.id] ?? {};

  return Object.freeze({
    providerId: technician.id,
    avatar: Object.freeze({ initials: technician.initials, label: `Ảnh đại diện của ${technician.name}` }),
    name: technician.name,
    rating: technician.rating,
    reviewCount: technician.reviewCount,
    verified: technician.kycVerified ?? technician.verified === true,
    specialty: override.specialty ?? category.specialty,
    experienceYears: override.experienceYears ?? Math.max(2, Math.round((technician.completedJobs ?? 100) / 48)),
    serviceArea: override.serviceArea ?? `${technician.location ?? 'Nha Trang, Khánh Hòa'} · bán kính ${technician.serviceRadiusKm ?? 10} km`,
    languages: Object.freeze(override.languages ?? ['Tiếng Việt']),
    skills: Object.freeze(override.skills ?? category.skills),
    introduction: override.introduction ?? technician.shortDescription,
    reviews: Object.freeze((override.reviews ?? defaultReviews).map((review) => Object.freeze({ ...review }))),
  });
}
