import { adaptProfileRow } from '../adapters.js';
import { requireSupabaseClient, unwrap } from './shared.js';

const profileColumns = 'user_id, role, display_name, avatar_url, status, created_at, updated_at';

export function createSupabaseProfilesRepository(supabase) {
  const client = requireSupabaseClient(supabase);
  const getById = async (userId) => {
    const result = await client.from('profiles').select(profileColumns).eq('user_id', userId).maybeSingle();
    return adaptProfileRow(unwrap(result, 'profiles.getById'));
  };

  const getCurrentUserId = async () => {
    const authResult = await client.auth.getUser();
    if (authResult.error?.name === 'AuthSessionMissingError') return null;
    return unwrap(authResult, 'profiles.getCurrentUser')?.user?.id ?? null;
  };

  return Object.freeze({
    getById,
    getCurrentUserId,
    async getCurrent() {
      const userId = await getCurrentUserId();
      return userId ? getById(userId) : null;
    },
    async getPhone(userId) {
      const result = await client.rpc('get_profile_phone', { target_user_id: userId });
      return unwrap(result, 'profiles.getPhone');
    },
    async saveCurrent({ name, phone = null, avatarUrl = null }) {
      const result = await client.rpc('upsert_current_customer_profile', {
        new_display_name: name,
        new_phone: phone,
        new_avatar_url: avatarUrl,
      });
      return adaptProfileRow(unwrap(result, 'profiles.saveCurrent'));
    },
  });
}
