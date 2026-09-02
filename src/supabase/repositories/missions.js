import { adaptMissionRow } from '../adapters.js';
import { requireSupabaseClient, unwrap } from './shared.js';

const missionColumns = [
  'id', 'client_id', 'provider_id', 'service_category', 'problem_description',
  'diagnostic_summary', 'address_id', 'address_text', 'client_latitude',
  'client_longitude', 'status', 'version', 'final_authorized_amount', 'currency',
  'payment_status', 'requested_at', 'completed_at',
  'scheduled_for',
].join(', ');

const activeStatuses = ['requested', 'searching', 'offered', 'accepted', 'travelling', 'arrived', 'quote_pending', 'in_progress', 'supplement_pending', 'completed_pending_payment'];

export function createSupabaseMissionsRepository(supabase) {
  const client = requireSupabaseClient(supabase);
  return Object.freeze({
    async getById(missionId) {
      const result = await client.from('missions').select(missionColumns).eq('id', missionId).maybeSingle();
      return adaptMissionRow(unwrap(result, 'missions.getById'));
    },
    async listForClient(clientId) {
      const result = await client.from('missions')
        .select(missionColumns)
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      return Object.freeze((unwrap(result, 'missions.listForClient') ?? []).map(adaptMissionRow));
    },
    async getActiveCurrent() {
      const result = await client.from('missions').select(missionColumns)
        .in('status', activeStatuses).order('created_at', { ascending: false }).limit(1).maybeSingle();
      return adaptMissionRow(unwrap(result, 'missions.getActiveCurrent'));
    },
    async createCurrent(draft) {
      const result = await client.rpc('create_current_customer_mission', {
        new_service_category: draft.serviceCategory,
        new_problem_description: draft.problemDescription,
        new_diagnostic_summary: draft.diagnosticSummary ?? null,
        new_address_id: draft.addressId ?? null,
        new_address_text: draft.address,
        new_client_latitude: draft.clientLocation.latitude,
        new_client_longitude: draft.clientLocation.longitude,
        new_scheduled_for: draft.scheduledFor ?? null,
      });
      return adaptMissionRow(unwrap(result, 'missions.createCurrent'));
    },
    async cancelCurrent(mission) {
      const result = await client.rpc('cancel_current_customer_mission', {
        target_mission_id: mission.id,
        expected_version: mission.version,
      });
      return adaptMissionRow(unwrap(result, 'missions.cancelCurrent'));
    },
    async createOffers(missionId, limit = 10) {
      const result = await client.rpc('create_current_customer_mission_offers', {
        target_mission_id: missionId,
        offer_limit: limit,
      });
      return Object.freeze([...(unwrap(result, 'missions.createOffers') ?? [])]);
    },
    async completeExternalPayment(mission) {
      return adaptMissionRow(unwrap(await client.rpc('complete_current_customer_external_payment', {
        target_mission_id: mission.id, expected_version: mission.version,
      }), 'missions.completeExternalPayment'));
    },
    async createReview(missionId, rating, comment = null) {
      return Object.freeze({ ...(unwrap(await client.rpc('create_current_customer_review', {
        target_mission_id: missionId, new_rating: rating, new_comment: comment,
      }), 'missions.createReview') ?? {}) });
    },
    async getCurrentUserHistory() {
      return Object.freeze([...(unwrap(await client.rpc('get_current_user_mission_history'), 'missions.getCurrentUserHistory') ?? [])]);
    },
  });
}
