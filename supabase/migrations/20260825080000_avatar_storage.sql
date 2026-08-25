-- L31: avatar upload was a fully disabled placeholder ("PNG or JPG, up to
-- 2 MB. Coming soon.") — profiles.avatar_url already existed and was
-- already seeded from OAuth metadata on first sign-in, but nothing ever
-- wrote to it afterward and nothing ever rendered it (every Avatar in the
-- app only ever showed AvatarFallback initials). This is the first use of
-- Supabase Storage in this repo.
--
-- Bucket is public (served via getPublicUrl(), no signed URLs) — a profile
-- picture isn't sensitive, and every teammate needs to see it without an
-- extra auth round trip, the same way avatars work in essentially every
-- app that has them. bucket-level file_size_limit/allowed_mime_types
-- mirror the "PNG or JPG, up to 2 MB" copy the placeholder UI already
-- promised, as a database backstop behind the equivalent client-side
-- check — same "client check + DB backstop" shape this schema already
-- uses everywhere else (description-required, manual-entry-allowed,
-- future-dated entries).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Each person's avatar lives at a fixed path, "{user_id}/avatar" — no file
-- extension, since storage.objects doesn't need one to serve correctly
-- (the upload call's own contentType is what controls that) and a fixed
-- path means every re-upload is an in-place upsert, never a second
-- lingering object from switching between PNG and JPEG. Ownership is
-- enforced the standard Supabase Storage way: the first path segment
-- (storage.foldername(name))[1] must equal the caller's own uid.
drop policy if exists "avatars_read_all" on storage.objects;
create policy "avatars_read_all" on storage.objects for select
  to authenticated using (bucket_id = 'avatars');

drop policy if exists "avatars_write_own" on storage.objects;
create policy "avatars_write_own" on storage.objects for insert
  to authenticated with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects for update
  to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects for delete
  to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
