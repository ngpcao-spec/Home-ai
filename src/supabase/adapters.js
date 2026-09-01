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
