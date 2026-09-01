import { adaptCustomerAddressRow } from '../adapters.js';
import { requireSupabaseClient, unwrap } from './shared.js';

const columns = 'id, customer_id, label, address_text, latitude, longitude, is_default, created_at, updated_at';

export function createSupabaseCustomerAddressesRepository(supabase) {
  const client = requireSupabaseClient(supabase);
  return Object.freeze({
    async listCurrent() {
      const result = await client.from('customer_addresses').select(columns).order('created_at', { ascending: true });
      return Object.freeze((unwrap(result, 'customerAddresses.listCurrent') ?? []).map(adaptCustomerAddressRow));
    },
    async save({ id = null, label, address, isDefault = false }) {
      const result = await client.rpc('save_current_customer_address', {
        target_address_id: id,
        new_label: label,
        new_address_text: address,
        make_default: isDefault,
      });
      return adaptCustomerAddressRow(unwrap(result, 'customerAddresses.save'));
    },
    async setDefault(id) {
      const result = await client.rpc('set_current_customer_default_address', { target_address_id: id });
      return adaptCustomerAddressRow(unwrap(result, 'customerAddresses.setDefault'));
    },
    async delete(id) {
      const result = await client.rpc('delete_current_customer_address', { target_address_id: id });
      unwrap(result, 'customerAddresses.delete');
    },
  });
}
