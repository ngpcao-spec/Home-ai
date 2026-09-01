import { adaptMissionRow } from '../adapters.js';
import { requireSupabaseClient, unwrap } from './shared.js';

const missionColumns = [
  'id', 'client_id', 'provider_id', 'service_category', 'problem_description',
  'diagnostic_summary', 'address_id', 'address_text', 'client_latitude',
  'client_longitude', 'status', 'version', 'final_authorized_amount', 'currency',
  'payment_status', 'requested_at', 'completed_at',
].join(', ');

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
  });
}
