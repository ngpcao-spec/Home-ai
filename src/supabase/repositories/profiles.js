import { adaptProfileRow } from '../adapters.js';
import { requireSupabaseClient, unwrap } from './shared.js';

const profileColumns = 'user_id, role, display_name, avatar_url, status, created_at, updated_at';

export function createSupabaseProfilesRepository(supabase) {
  const client = requireSupabaseClient(supabase);
  const getById = async (userId) => {
    const result = await client.from('profiles').select(profileColumns).eq('user_id', userId).maybeSingle();
    return adaptProfileRow(unwrap(result, 'profiles.getById'));
  };

  return Object.freeze({
    getById,
    async getCurrent() {
      const authResult = await client.auth.getUser();
      if (authResult.error?.name === 'AuthSessionMissingError') return null;
      const user = unwrap(authResult, 'profiles.getCurrentUser')?.user;
      return user ? getById(user.id) : null;
    },
    async getPhone(userId) {
      const result = await client.rpc('get_profile_phone', { target_user_id: userId });
      return unwrap(result, 'profiles.getPhone');
    },
  });
}
