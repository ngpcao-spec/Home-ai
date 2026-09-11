-- Storage remove() must first resolve the caller's object under SELECT RLS.
create policy provider_avatar_objects_select_self on storage.objects
  for select to authenticated using (
    bucket_id='provider-avatars'
    and (storage.foldername(name))[1]=(select auth.uid())::text
  );
