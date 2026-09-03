import { createOptionalSupabaseRepositories } from '../supabase/repositories/index.js';

export const googleOAuthRedirectTo = 'https://ngpcao-spec.github.io/Home-ai/';

const isEndedSessionError = (error) => error?.name === 'AuthSessionMissingError'
  || error?.name === 'AuthInvalidTokenResponseError'
  || [400, 401].includes(error?.status);

const getDisplayName = (user) => {
  const metadata = user?.user_metadata ?? {};
  return String(metadata.full_name ?? metadata.name ?? user?.email?.split('@')[0] ?? 'Khách hàng HOME AI').trim();
};

export function createGoogleCustomerAuth(
  runtimeConfig = globalThis.__HOME_AI_CONFIG__,
  repositoryFactory = createOptionalSupabaseRepositories,
) {
  const repositories = repositoryFactory(runtimeConfig);
  if (!repositories?.enabled || !repositories.client) {
    return Object.freeze({
      enabled: false,
      async resume() { return null; },
      async signIn() { throw new Error('Supabase is not configured'); },
      async signOut() {},
    });
  }

  const ensureCustomerProfile = async (user) => {
    const existing = await repositories.profiles.getById(user.id);
    if (existing) {
      if (existing.role !== 'customer') throw new Error('Google account is not a customer');
      return existing;
    }
    return repositories.profiles.saveCurrent({
      name: getDisplayName(user),
      phone: user.phone ?? null,
      avatarUrl: user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
    });
  };

  return Object.freeze({
    enabled: true,
    async resume() {
      const { data: sessionData, error: sessionError } = await repositories.client.auth.getSession();
      if (sessionError) {
        if (isEndedSessionError(sessionError)) return null;
        throw sessionError;
      }
      const session = sessionData?.session ?? null;
      if (!session?.user?.id) return null;
      const { data: userData, error: userError } = await repositories.client.auth.getUser();
      if (userError) {
        if (isEndedSessionError(userError)) return null;
        throw userError;
      }
      const user = userData?.user ?? null;
      if (!user || session.user.id !== user.id) return null;
      const profile = await ensureCustomerProfile(user);
      return Object.freeze({ authenticated: true, session, profile });
    },
    async signIn() {
      const { data, error } = await repositories.client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: googleOAuthRedirectTo },
      });
      if (error) throw error;
      return data;
    },
    async signOut() {
      const { error } = await repositories.client.auth.signOut();
      if (error) throw error;
    },
  });
}
