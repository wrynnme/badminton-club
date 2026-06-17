-- Public bucket for global app assets (e.g. the custom QR centre logo uploaded by
-- the site owner). Uploads go through the service-role server action (bypasses RLS).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-assets', 'app-assets', true, 1048576, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
