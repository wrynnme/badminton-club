-- Custom payment receipt feature (#11/#12): owner-configured receipt presentation
-- + bank-account payment channel, per club.
--
-- `receipt_template` — standalone jsonb object (mirrors tournaments.prize_template,
-- NOT inside an existing settings blob). Holds presentation + payment config:
--   { footer_note?, fields:{court,shuttle,expense,discount}, bank?:{name,account_no,
--     account_name}, payment_show:{promptpay,bank}, theme?, bank_qr? }
-- validated app-side by ReceiptTemplateSchema (src/lib/club/receipt.ts). Default '{}'
-- = unset → parseReceiptTemplate falls back to DEFAULT_RECEIPT_TEMPLATE (current slip
-- layout: all fields shown, PromptPay only).
--
-- `receipt_logo_url` — uploaded club header logo (mirrors promptpay_qr_image), shown on
-- the slip in place of the 🏸 emoji. Stored in the club-qr bucket at {clubId}/receipt-logo.
--
-- Additive + idempotent: nullable / defaulted columns, `if not exists` guards so this
-- replays cleanly on prod and seeds fresh databases. Existing `select("*")` code is
-- unaffected (new columns simply ride along).
alter table public.clubs
  add column if not exists receipt_template jsonb not null default '{}'::jsonb,
  add column if not exists receipt_logo_url  text;
