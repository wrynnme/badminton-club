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

## Tournament System (in progress)

### Schema tables
- `tournaments` — id, owner_id, name, mode (`sports_day`|`competition`), status (`draft`|`registering`|`ongoing`|`completed`), format (`group_only`|`group_knockout`|`knockout_only`), has_lower_bracket, allow_drop_to_lower (default false), seeding_method (`random`|`by_group_score`), team_count, scoring_rules jsonb
- `teams` — id, tournament_id, name, color, seed
- `team_players` — id, team_id, profile_id?, display_name, role (`captain`|`member`)
- `groups` — id, tournament_id, name
- `group_teams` — group_id, team_id, position (อันดับในกลุ่ม)
- `matches` — id, tournament_id, round_type (`group`|`upper_qf`|`upper_sf`|`upper_final`|`lower_*`|`grand_final`), round_number, team_a_id, team_b_id, team_a_score, team_b_score, winner_id, status (`pending`|`in_progress`|`completed`), court?, scheduled_at?

### Knockout bracket logic
- Upper pairing: 1st-groupN vs 2nd-groupN+1 (cross-group)
- Lower pairing: 3rd-groupN vs 4th-groupN+1
- Bracket size: pad to power of 2 with BYE
- Tie-breaker: head-to-head → point diff → coin flip

### Pages
- `/tournaments` — list
- `/tournaments/new` — choose mode
- `/tournaments/[id]` — detail + bracket
- `/tournaments/[id]/setup` — config
- `/tournaments/[id]/teams` — manage teams/members
- `/tournaments/[id]/matches` — score entry

### Server actions (planned)
`createTournamentAction`, `addTeamAction`, `assignPlayerToTeamAction`, `generateGroupsAction`, `generateMatchesAction`, `seedKnockoutAction`, `recordMatchScoreAction`

## MCP servers
- **supabase**: apply migrations, run SQL, list tables — use `apply_migration` for all DDL
- **shadcn**: browse and add components

## Agent skills
Run once per machine: `npx skills add supabase/agent-skills`
`.agents/` is gitignored.
