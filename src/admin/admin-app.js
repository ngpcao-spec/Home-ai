import { createAdminAuth } from './admin-auth.js';

const messages = {
  login: 'Connectez-vous avec votre compte Google.', loading: 'Chargement…',
  denied: 'Accès refusé', authorized: 'HOME AI Admin — Accès autorisé',
  error: 'Impossible de vérifier l’accès. Veuillez réessayer.',
};

export async function initialiseAdminApp(root, factory = createAdminAuth) {
  let auth; let busy = false; let stopped = false;
  const render = (state) => {
    if (stopped) return;
    root.innerHTML = `<section class="admin-card" data-admin-state="${state}"><div class="brand"><img src="../provider-icon.svg" alt=""><strong>HOME <span>AI</span></strong></div><h1>HOME AI Admin</h1><p role="status">${messages[state]}</p>${state === 'login' ? '<button data-admin-login>Continuer avec Google</button>' : ''}${state === 'error' ? '<button data-admin-retry>Réessayer</button>' : ''}${['authorized','denied','error'].includes(state) && auth ? '<button class="secondary" data-admin-logout>Déconnexion</button>' : ''}</section>`;
  };
  const resume = async () => {
    busy = true; render('loading');
    try { auth ??= factory(); render((await auth.resume()).state); }
    catch { render('error'); }
    finally { busy = false; }
  };
  const click = async (event) => {
    if (busy || stopped) return;
    if (event.target.closest('[data-admin-retry]')) { await resume(); return; }
    const login = event.target.closest('[data-admin-login]');
    const logout = event.target.closest('[data-admin-logout]');
    if (!login && !logout) return;
    busy = true; render('loading');
    try {
      if (logout) { await auth.signOut(); render('login'); }
      else await auth.signIn();
    } catch { render('error'); }
    finally { busy = false; }
  };
  const visibility = () => { if (!busy && root.ownerDocument?.visibilityState === 'visible') void resume(); };
  root.addEventListener('click', click);
  root.ownerDocument?.addEventListener('visibilitychange', visibility);
  await resume();
  return { stop() { stopped = true; root.removeEventListener('click', click); root.ownerDocument?.removeEventListener('visibilitychange', visibility); } };
}

const root = globalThis.document?.getElementById('admin-root');
if (root) void initialiseAdminApp(root);
