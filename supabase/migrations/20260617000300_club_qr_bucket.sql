-- Storage bucket for owner-uploaded PromptPay QR images (Phase 1b).
-- Public bucket: the QR image is meant to be shown for collecting money; objects
-- are served via the public URL. Uploads go through the service-role server
-- action (bypasses RLS), so no insert policy is needed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-qr', 'club-qr', true, 1048576, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
