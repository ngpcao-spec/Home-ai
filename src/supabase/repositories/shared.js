export function requireSupabaseClient(client) {
  if (!client || typeof client.from !== 'function') {
    throw new TypeError('A Supabase client is required');
  }
  return client;
}

export function unwrap(result, operation) {
  if (result?.error) {
    const error = new Error(`Supabase ${operation} failed`);
    error.name = 'SupabaseRepositoryError';
    error.code = result.error.code;
    error.cause = result.error;
    throw error;
  }
  return result?.data ?? null;
}
