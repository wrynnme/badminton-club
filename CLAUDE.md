@AGENTS.md

# Project: ก๊วนแบด (Badminton Club)

## Stack
- Next.js 16 App Router · Tailwind v4 · shadcn/ui · TanStack Form v1
- Supabase (Postgres + RLS) — MCP connected via `.mcp.json`
- Auth: LINE Login + Guest mode (HMAC-signed cookie, no Supabase Auth)
- Font: Google Font Anuphan (`thai` + `latin` subsets)

## กฏการพัฒนา (สำคัญ)

- **Forms**: ใช้ TanStack Form ทุกอัน — `useForm` + `form.Field` + `form.Subscribe`
- **UI**: shadcn/ui components เท่านั้น — ห้ามเขียน raw `<input>` / `<button>` เปล่า
- **Server actions**: รับ plain typed object (ไม่ใช่ FormData) — export type ไว้ใน `clubs.ts`
- **Validation**: client-side ใน TanStack validators + server-side ใน zod (ทำทั้ง 2 ชั้น)
- **DB writes**: ทำผ่าน server actions ด้วย service role key (bypass RLS)

## Key conventions
- Supabase key env var is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (not ANON_KEY)
- DB column for club cost is `total_cost` (not `cost_per_person`) — set by owner after game ends
- `club_players` has `position` column for drag-and-drop ordering
- Writes go through server actions using `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS)
- Session stored in `bc_session` cookie (see `src/lib/auth/session.ts`)
- Auth redirects: use `?redirectTo=/path` on login page; LINE OAuth stores it in `line_redirect_to` cookie
- `loginRedirect()` in `clubs.ts` uses `referer` header to auto-populate `redirectTo`
- Player list auto-refreshes via `router.refresh()` every 30s; manual refresh button included
- `SortablePlayerList` uses `@dnd-kit` with `activationConstraint: { distance: 8 }` for mobile compat

## MCP servers
- **supabase**: apply migrations, run SQL, list tables — use `apply_migration` for all DDL
- **shadcn**: browse and add components

## Agent skills
Run once per machine: `npx skills add supabase/agent-skills`
`.agents/` is gitignored.
