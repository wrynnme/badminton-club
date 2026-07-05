-- Allow SVG uploads for the global QR centre logo (site owner only, via the
-- service-role uploadQrLogoAction, which additionally rejects scriptable SVGs).
-- Adds a permitted MIME type only — existing png/jpeg/webp uploads are unaffected;
-- idempotent (full array set), reversible by upserting the prior 3-type array.
update storage.buckets
  set allowed_mime_types = array['image/png','image/jpeg','image/webp','image/svg+xml']
  where id = 'app-assets';
