export function createAdminRepository(client, supabaseUrl) {
  const read = async (name, args = {}) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw Object.assign(new Error('Không thể tải dữ liệu Admin.'), { code: error.code });
    return data;
  };
  return Object.freeze({
    missions: (filter, offset) => read('get_admin_missions', { new_filter: filter, page_offset: offset }),
    mission: (id) => read('get_admin_mission_detail', { target_mission_id: id }),
    providers: (offset) => read('get_admin_providers', { page_offset: offset }),
    provider: (id) => read('get_admin_provider_profile', { target_provider_id: id }),
    avatar(path) {
      return /^[0-9a-f-]{36}\/avatar\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/.test(path ?? '')
        ? `${supabaseUrl}/storage/v1/object/public/provider-avatars/${path}` : null;
    },
    subscribe(invalidate) {
      // Existing business event stream is an invalidation signal only: no payload retained.
      // Avoid subscribing to GPS-rich mission/provider_status rows.
      const channel = client.channel('home-ai-admin-missions')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mission_events' }, () => invalidate())
        .subscribe();
      return () => { void client.removeChannel(channel); };
    },
  });
}
