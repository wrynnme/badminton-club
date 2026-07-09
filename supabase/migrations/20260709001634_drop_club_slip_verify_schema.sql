-- Drop the removed inbound slip-verification schema.
--
-- Important: Storage files and the `payment-slips` bucket must be deleted
-- through the Supabase Storage API before this migration is applied to a
-- linked/non-empty project. Direct SQL deletion from storage tables is blocked
-- by Supabase and can orphan files in Supabase Storage.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'payment-slips'
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'payment_slips_bucket_not_empty'
      USING ERRCODE = 'P0001',
            DETAIL = 'Delete payment-slips objects through the Storage API before applying this migration.';
  END IF;
END
$$;

DROP TABLE IF EXISTS public.club_payment_slips;
DROP TABLE IF EXISTS public.club_billing_secrets;

ALTER TABLE public.clubs
  DROP COLUMN IF EXISTS billing_verify_settings;
