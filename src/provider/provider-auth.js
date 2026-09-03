import { createOptionalSupabaseRepositories } from '../supabase/repositories/index.js';

export const providerGoogleOAuthRedirectTo = 'https://ngpcao-spec.github.io/Home-ai/provider.html';

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
      const [{ data: sessionData, error: sessionError }, { data: userData, error: userError }] = await Promise.all([
        repositories.client.auth.getSession(),
        repositories.client.auth.getUser(),
      ]);
      if (sessionError) throw sessionError;
      if (userError) throw userError;
      const session = sessionData?.session ?? null;
      return session?.user?.id && session.user.id === userData?.user?.id ? session : null;
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
