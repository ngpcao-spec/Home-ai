import { createOptionalSupabaseRepositories } from '../supabase/repositories/index.js';

export const providerGoogleOAuthRedirectTo = 'https://ngpcao-spec.github.io/Home-ai/provider.html';

const isEndedSessionError = (error) => error?.name === 'AuthSessionMissingError'
  || error?.name === 'AuthInvalidTokenResponseError'
  || [400, 401].includes(error?.status);

export function createProviderGoogleAuth(
  runtimeConfig = globalThis.__HOME_AI_CONFIG__,
  repositoryFactory = createOptionalSupabaseRepositories,
) {
  const repositories = repositoryFactory(runtimeConfig);
  if (!repositories?.enabled || !repositories.client) {
    return Object.freeze({ enabled: false, async getSession() { return null; }, async signIn() {}, async signOut() {} });
  }
  return Object.freeze({
    enabled: true,
    async getSession() {
      const { data: sessionData, error: sessionError } = await repositories.client.auth.getSession();
      if (sessionError) {
        if (isEndedSessionError(sessionError)) return null;
        throw Object.assign(new Error('Provider auth session validation failed'), { safeStage: 'AUTH_SESSION' });
      }
      const session = sessionData?.session ?? null;
      if (!session?.user?.id) return null;
      const { data: userData, error: userError } = await repositories.client.auth.getUser();
      if (userError) {
        if (isEndedSessionError(userError)) return null;
        throw Object.assign(new Error('Provider auth user validation failed'), { safeStage: 'AUTH_USER' });
      }
      return session.user.id === userData?.user?.id ? session : null;
    },
    async signIn() {
      const { data, error } = await repositories.client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: providerGoogleOAuthRedirectTo },
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
