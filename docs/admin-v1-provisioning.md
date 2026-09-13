# Admin V1 — provisionnement explicite

Cette étape ne provisionne personne automatiquement. L'email attendu sert uniquement à retrouver manuellement le compte dans le Dashboard Supabase, jamais à autoriser une API.

Avant la première connexion, après autorisation de déploiement :
1. Appliquer `20260913120000_admin_access.sql` et publier `/Home-ai/admin/`.
2. Ajouter exactement `https://ngpcao-spec.github.io/Home-ai/admin/` à Authentication → URL Configuration → Redirect URLs. Google est déjà configuré ; ne changer aucun secret.
3. Ouvrir Admin et choisir « Continuer avec Google », avec le compte prévu. « Accès refusé » est normal tant que son UUID n'est pas provisionné.
4. Dans Authentication → Users, retrouver ce compte et vérifier son identité Google. Copier uniquement son UUID Supabase et obtenir l'autorisation explicite de provisionner CET UUID.
5. Exécuter le SQL ci-dessous uniquement via l'accès administratif Supabase, en remplaçant le marqueur UUID. Ne jamais l'exécuter depuis le navigateur ni ajouter une RPC publique de promotion.

```sql
begin;
do $$
declare target uuid := 'REMPLACER_PAR_UUID_EXPLICITEMENT_AUTORISE';
begin
  if not exists(select 1 from auth.users where id=target)
     or not exists(select 1 from auth.identities where user_id=target and provider='google') then
    raise exception 'Identité Google Supabase introuvable';
  end if;
  if exists(select 1 from public.profiles where role='admin' and user_id<>target) then
    raise exception 'Un autre administrateur existe déjà';
  end if;
  if exists(select 1 from public.profiles where user_id=target) then
    raise exception 'Profil existant : vérifier séparément ses données avant toute conversion';
  end if;
  insert into public.profiles(user_id,role,display_name,status)
    values(target,'admin','HOME AI Admin','active');
end $$;
commit;
```

6. Actualiser Admin : `require_current_admin()` doit confirmer cet UUID et afficher « HOME AI Admin — Accès autorisé ».
7. Vérifier qu'il existe exactement un profil admin et que les comptes Client/Provider n'ont pas changé.

Si un profil existe déjà, STOP : ne pas supprimer ses données ou contourner les triggers de protection des rôles. Auditer ce profil puis autoriser séparément sa conversion.

La session Admin utilise `home-ai-admin-auth-v1` et PKCE, sans réutiliser le stockage Supabase Client/Provider. Déconnexion `scope: local`, sans nettoyage global de localStorage et sans déconnexion globale des autres sessions.

Les futures mutations Admin devront appeler la même autorité backend et enregistrer un événement d'audit sans données sensibles. Aucun dashboard ni workflow KYC n'est inclus ici.
