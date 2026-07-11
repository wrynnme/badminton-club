-- Bind a LINE group chat to a club, enabling group billing:
-- the bot pushes bill + PromptPay QR + @mentions into the bound group, bucketed
-- by amount owed. LINE only exposes a groupId through webhook events, so the id
-- is captured when a manager posts the bind command + the club's join_token in
-- the group (see src/app/api/line/webhook/route.ts).

alter table public.clubs
  add column if not exists line_group_id text;

-- A given LINE group binds to at most one club (rebinding the same group to the
-- same club is a no-op UPDATE; binding a group already owned by another club
-- fails the unique constraint). NULL (unbound) rows are unconstrained.
create unique index if not exists uniq_clubs_line_group_id
  on public.clubs (line_group_id)
  where line_group_id is not null;
