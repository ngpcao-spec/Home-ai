export const adaptProfileRow = (row) => row ? Object.freeze({
  id: row.user_id,
  role: row.role,
  name: row.display_name,
  avatarUrl: row.avatar_url ?? null,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
}) : null;

export const adaptCustomerAddressRow = (row) => row ? Object.freeze({
  id: row.id,
  label: row.label,
  address: row.address_text,
  latitude: row.latitude ?? null,
  longitude: row.longitude ?? null,
  isDefault: row.is_default === true,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
}) : null;

export const adaptMissionRow = (row) => row ? Object.freeze({
  id: row.id,
  clientId: row.client_id,
  providerId: row.provider_id ?? null,
  serviceCategory: row.service_category,
  problemDescription: row.problem_description,
  diagnosticSummary: row.diagnostic_summary ?? null,
  addressId: row.address_id ?? null,
  address: row.address_text,
  clientLocation: Object.freeze({ latitude: row.client_latitude, longitude: row.client_longitude }),
  status: row.status,
  version: row.version,
  finalAuthorizedAmount: row.final_authorized_amount ?? null,
  currency: row.currency,
  paymentStatus: row.payment_status,
  requestedAt: row.requested_at,
  completedAt: row.completed_at ?? null,
  scheduledFor: row.scheduled_for ?? null,
}) : null;

export const adaptQuoteRow = (row) => {
  if (!row) return null;
  const items = [...(row.quote_items ?? [])]
    .sort((left, right) => left.position - right.position)
    .map((item) => Object.freeze({
      id: item.id,
      type: item.item_type,
      description: item.description,
      amount: Number(item.amount),
      position: item.position,
    }));
  const laborAmount = items.filter(({ type }) => type === 'labor').reduce((sum, item) => sum + item.amount, 0);
  const partsAmount = items.filter(({ type }) => type === 'part').reduce((sum, item) => sum + item.amount, 0);
  return Object.freeze({
    id: row.id,
    missionId: row.mission_id,
    parentQuoteId: row.parent_quote_id ?? null,
    version: row.version,
    type: row.type,
    status: row.status,
    diagnosis: row.diagnosis,
    finding: row.diagnosis,
    recommendedWork: items.map(({ description }) => description).join(', '),
    recommendedTasks: Object.freeze(items.map(({ description }) => description)),
    items: Object.freeze(items),
    laborAmount,
    partsAmount,
    totalAmount: Number(row.total_amount),
    currency: row.currency,
    warrantyDays: row.warranty_days,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? null,
  });
};

export const adaptProviderRow = (row) => {
  if (!row) return null;
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return Object.freeze({
    id: row.provider_id,
    name: profile?.display_name ?? '',
    avatarUrl: profile?.avatar_url ?? null,
    specialty: row.specialty,
    experienceYears: row.experience_years,
    serviceRadiusKm: Number(row.service_radius_km),
    rating: Number(row.rating_average),
    reviewCount: row.review_count,
    completedJobs: row.completed_jobs,
    reliabilityScore: Number(row.reliability_score),
    description: row.description ?? '',
    languages: Object.freeze([...(row.languages ?? [])]),
    verified: row.kyc_status === 'verified',
    active: row.active === true,
  });
};

export const adaptMatchingProviderRow = (row) => row ? Object.freeze({
  id: row.provider_id,
  name: row.display_name ?? '',
  avatarUrl: row.avatar_url ?? null,
  initials: (row.display_name ?? 'AI').split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]).join('').toUpperCase(),
  category: row.service_category,
  categoryLabel: row.specialty,
  specialty: row.specialty,
  priceFrom: row.base_price ?? 0,
  indicativePrice: row.base_price ?? 0,
  currency: row.currency,
  serviceRadiusKm: Number(row.service_radius_km),
  rating: Number(row.rating_average),
  reviewCount: row.review_count,
  completedJobs: row.completed_jobs,
  reliabilityScore: Number(row.reliability_score),
  shortDescription: row.description ?? row.specialty,
  languages: Object.freeze([...(row.languages ?? [])]),
  verified: true,
  kycVerified: true,
  active: true,
  online: true,
  available: true,
  availability: 'Đang sẵn sàng',
  latitude: row.latitude,
  longitude: row.longitude,
  lastLocationAt: row.last_location_at,
  straightLineDistanceKm: Number(row.straight_line_distance_km),
  distanceKm: Number(row.straight_line_distance_km),
}) : null;
