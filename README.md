# ก๊วนแบด (Badminton Club)

ระบบจัดก๊วนตีแบด + จัดการทัวร์นาเมนต์กีฬาสี

**Stack**: Next.js 16 App Router · Tailwind v4 · shadcn/ui · TanStack Form v1 · Supabase (Postgres + RLS) · LINE Login + Guest · next-intl (TH/EN, cookie-based) · @bprogress/next (nav progress) · @dnd-kit · Anuphan font

**เวอร์ชันล่าสุด**: v0.12.0 — หน้า "มีอะไรใหม่" ที่ `/whats-new` (source เดียว: `src/lib/changelog.ts`, mirror ที่ `CHANGELOG.md`)

**Deployed** (กลยุทธ์ branch: feature → `develop` [CI gate] → `master` [prod]):
- Production: https://kuanbad.vercel.app (**master** branch)
- Dev/Test: https://kuanbad-dev.vercel.app (**develop** branch — auto-update on push)

---

## ติดตั้ง

```bash
npm install
cp .env.example .env.local
```

`.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

LINE_CHANNEL_ID=...
LINE_CHANNEL_SECRET=...
LINE_REDIRECT_URI=http://localhost:3000/api/auth/line/callback

NEXT_PUBLIC_APP_URL=http://localhost:3000
SESSION_SECRET=<openssl rand -hex 32>
```

```bash
npm run dev
```

---

## Supabase MCP (Claude Code)

`.mcp.json` อยู่ใน repo — Claude Code เชื่อม Supabase อัตโนมัติ

```bash
npx skills add supabase/agent-skills   # ติดตั้งครั้งเดียวต่อเครื่อง
```

---

## ก๊วนแบด (Club System)

ก๊วนตีแบดรายวัน — ลงชื่อ/เช็คอิน → จัดคิวแมตช์อัตโนมัติ → บันทึกผล → หารค่าใช้จ่าย → เก็บเงิน

### Rotation queue (จัดคิวอัตโนมัติ)

- **โหมดหมุนคิว** (`rotation_mode`): `fair_queue` (ทุกคนหมุนตามคิว) · `winner_stays` (ผู้ชนะอยู่ต่อ, จำกัดด้วย `winner_stays_max`) · `fair_winner_fallback` (หมุนเวียนทั่วถึง — fair เป็นหลัก แต่ถ้าคนพักไม่พอ ผู้ชนะอยู่ต่อ)
- **โหมดเลือกคู่** (`queue_mode`): `rest_longest` (พักนานสุดก่อน) · `fifo` · `level_match` (จับคู่ระดับใกล้กัน) · `smart`
- เดี่ยว/คู่ (`players_per_team` 1|2) · **หลายสนาม** (ผู้ชนะอยู่ต่อสนามตัวเองครบทุกสนาม) · ล็อคคู่ (`club_locked_pairs`)
- ปุ่ม **"ทุกสนาม"** สร้างแมตช์ให้ทุกสนามว่างพร้อมกัน · drag จัดลำดับคิว · partial match (จองสนามก่อนผู้เล่นครบ)
- **เช็คอิน = สัญญาณความพร้อม** → `not_ready_action`: `skip` (ตัดคนยังไม่เช็คอินออก, default) | `requeue` (ดึงได้แต่ต่อท้ายคิว)
- **จับเวลาต่อเกม** (`game_time_limit_min`) — แมตช์ที่เล่นเกินเวลา timer เปลี่ยนเป็นแดง + ป้าย "เกินเวลา"
- ระดับฝีมือรายก๊วน (per-club levels, copy-on-write จากชุดกลาง) · realtime broadcast (คิวอัปเดตข้ามอุปกรณ์)

### ค่าใช้จ่าย + เก็บเงิน

- หารค่าสนาม + ค่าลูก + ค่าใช้จ่ายอื่น เป็นรายคน
- **QR พร้อมเพย์รายคน** (ฝังยอด) + ติ๊ก "จ่ายแล้ว" · ส่ง/ดาวน์โหลดสลิปการ์ด
- **เก็บเงินผ่าน LINE**: บอทส่งบิล (QR ฝังยอด) → ผู้เล่นส่งสลิปกลับ → ตรวจ + ติ๊กจ่ายอัตโนมัติ
- ตรวจสลิปรายก๊วน 2 โหมด: `manual` (เจ้าของยืนยันเอง) | `byok` (ใส่ key SlipOK/EasySlip → auto-verify)

### อื่นๆ

- Reserve / waiting list (สำรอง) · co-admin · **preset ก๊วน** (เทมเพลตสร้างก๊วนใหม่) · นำเข้ารายชื่อจากข้อความสมัคร (LINE)

---

## Tournament System

### Formats

| format | คำอธิบาย |
|--------|---------|
| `group_only` | แบ่งกลุ่ม round-robin |
| `group_knockout` | แบ่งกลุ่ม → top N เข้า knockout |
| `knockout_only` | single/double elimination ทันที |

### Match Unit

| unit | คำอธิบาย |
|------|---------|
| `team` | ทีม vs ทีม |
| `pair` | คู่ (2 คน) vs คู่ — จับคู่ภายในทีม แข่งข้ามทีม |

### Pair Division (N-Division)

ตั้งค่า `pair_division_thresholds: number[]` ต่อ tournament (sorted ASC):
- `[]` = ไม่แบ่ง (ทุกคู่เจอกัน)
- `[5]` → 2 divisions: `pair_level > 5` → Division 1 (top), `≤ 5` → Division 2
- `[3, 7]` → 3 divisions: `> 7` → Div 1; `> 3 && ≤ 7` → Div 2; `≤ 3` → Div 3
- Division 1 = top tier (highest skill); ขนาด array = `N-1` thresholds → `N` divisions
- คู่ข้าม Division ไม่เจอกันในรอบแบ่งกลุ่ม — เจอกันได้ในรอบ knockout (per-Division bracket)

### Level

- Player level: free numeric (เช่น `3`, `3.5`, `7`) — ไม่มี fixed scale
- Pair level: auto-computed = player1.level + player2.level (sum) — ไม่ต้องกรอกเอง

### CSV Import (2-step)

**Step 1 — ผู้เล่น**

```
team, color, id_player*, display_name*, role, level
```

- upsert by `id_player` (csv_id) — ถ้าซ้ำ → update; ใหม่ → insert
- auto-create team ถ้าไม่มี

**Step 2 — จับคู่**

```
team, pair_id, id_player_1*, id_player_2*, pair_name
```

- `pair_id` optional — UUID ของคู่ที่มีอยู่สำหรับ upsert; ว่าง = สร้างใหม่
- `pair_level` ไม่ต้องใส่ — คำนวณอัตโนมัติจาก player levels
- `team` column เป็น informational เท่านั้น — team validate จาก player membership

### CSV Export

- **ผลแข่งขัน** — match results
- **รายชื่อ** — roster (ทีม, id_player, ชื่อ, level, pair_id, คู่, pair_level)
- **Template ผู้เล่น** — blank template
- **Template จับคู่** — pre-filled จาก player csv_ids (pair_id ว่าง = new pairs)

### Knockout Bracket

- Single-elimination: seed 1 เจอ seed 2 ได้เฉพาะรอบชิง
- Double-elimination: upper losers → lower via `loser_next_match_id`
- `allow_drop_to_lower=false`: lower seeded จาก 3rd/4th per group
- Grand final: upper vs lower winner (single match)
- BYE auto-advance; reset blocked ถ้า next match จบแล้ว

### Scoring

- Win = 3 pts, Draw = 1, Loss = 0
- Match winner = games ชนะมากกว่า
- Tie-break: point diff → points for

---

## โครงสร้าง

```
src/
├── app/
│   ├── (app)/
│   │   ├── page.tsx                        # Login (LINE / Guest)
│   │   ├── clubs/                          # ก๊วนแบด
│   │   └── tournaments/
│   │       ├── page.tsx                    # Tournament list
│   │       ├── new/page.tsx                # Create
│   │       └── [id]/page.tsx               # Detail — tabs (ทีม/กลุ่ม/คู่/Knockout/ตารางคิว/ตั้งค่า*)
│   ├── (public)/
│   │   ├── t/[token]/page.tsx              # Public share page (no auth)
│   │   └── t/[token]/tv/page.tsx           # TV display mode
│   └── api/auth/                           # LINE OAuth + guest + logout
├── components/tournament/
│   ├── tournament-tabs.tsx             # Tab wrapper (client) — settings tab gated by canEdit
│   ├── team-manager.tsx                # Teams + members
│   ├── pair-manager.tsx                # Create/delete pairs (auto pair_level)
│   ├── pair-stage.tsx                  # Pair matches + division standings
│   ├── manual-match-dialog.tsx         # Manual pair match creation
│   ├── group-stage.tsx                 # Team mode group stage
│   ├── knockout-stage.tsx              # Upper / lower / grand_final
│   ├── match-queue.tsx                 # Drag-drop queue + court + start/end + auto-rotate (Phase 9–10)
│   ├── court-manager.tsx               # Court list (DnD) — Settings tab, owner-only (Phase 10)
│   ├── csv-import-dialog.tsx           # 2-step CSV import
│   ├── export-buttons.tsx              # Export + templates
│   ├── share-controls.tsx              # Share link (owner)
│   ├── co-admin-controls.tsx           # Co-admin management (owner)
│   ├── audit-log-panel.tsx             # Audit log (owner + co-admin)
│   ├── tournament-live-wrapper.tsx     # Supabase Realtime
│   ├── tv-match-card.tsx · tv-auto-refresh.tsx  # TV display
│   ├── public/                         # Public share page components (hero/overview/shell)
│   ├── match-row.tsx · score-form.tsx · standings-table.tsx
│   └── bracket-view.tsx · bracket-match-card.tsx
└── lib/
    ├── actions/
    │   ├── tournaments.ts              # CRUD + CSV import
    │   ├── matches.ts                  # generate* + score + createManualMatchAction
    │   ├── pairs.ts                    # createPairAction (auto level/code)
    │   └── admins.ts                   # co-admin + audit log actions
    ├── tournament/
    │   ├── permissions.ts              # assertIsOwner, assertCanEdit
    │   ├── audit.ts                    # writeAuditLog
    │   ├── bracket.ts · scheduling.ts · scoring.ts · competitor.ts
    │   └── bracket-visual.ts
    ├── export/csv.ts
    └── types.ts
```

---

## Roadmap

### Tournament System

- ✅ Phase 0–4 — CRUD · group stage · pair mode · double elimination · CSV import/export · player/pair level · configurable division threshold
- ✅ Phase 5 — Bracket visualization (`/tournaments/[id]/bracket`)
- ✅ Phase 6 — Realtime + public share link (`/t/[token]`)
- ✅ Phase 7a — LINE notification + Print/PDF
- ✅ Phase 7b — Co-admin · audit log · tournament tabs · manual match creation · UI improvements
- ✅ Phase 8 — TV display mode (`/t/[token]/tv`)
- ✅ Phase 9 — Match Schedule/Queue tab (drag-drop ordering, court, start/end buttons)
- ✅ Phase 10 — Smart Scheduling: court list, court occupancy guard (partial UNIQUE index), auto-rotate queue (anti back-to-back), atomic reorder via `reorder_tournament_queue` RPC
- ✅ Phase 11 — Pre-tournament Settings (feature flags): LINE notify toggles, queue bracket preference + chunk size, auto-advance, manual match guard, force bracket reset, cooldown, realtime, audit log, `require_court_to_start`
- ✅ Perf pass (2026-05-21) — 14 FK covering indexes via `add_fk_indexes` migration; parallelized page fetches (`/tournaments/[id]`, `/t/[token]`, `/t/[token]/tv`); co-admin can now edit Settings tab
- ✅ Per-court referee view (2026-05-24) — `/t/[token]/court/[n]` phone-first page showing in_progress + top 2 pending per court
- ✅ Entity stats drill-down (2026-05-24, Phases A–D) — admin + public stat pages for pair / player / team / division (`/tournaments/[id]/stats/...` + `/t/[token]/stats/...`); clickable names everywhere via `EntityLink`; navigation progress bar (`@bprogress/next`); root-level `LoadingSpinner` Suspense fallback
- ✅ Phase 12 — `require_checkin` flag + per-player/bulk check-in flow (atomic `start_match_atomic` RPC)
- ✅ Phase 13 — Competition mode (`mode=competition`, multi-class NB/BG/N/S/P-, per-class group/knockout, team-aware grouping, one-way upgrade)

### ก๊วนแบด (Club)

- ✅ Rotation queue (fair_queue / winner_stays / fair_winner_fallback) · multi-court · locked pairs · build-all-courts
- ✅ Check-in + `not_ready_action` · game-time over-time indicator
- ✅ Per-club skill levels + level-based matchmaking
- ✅ Reserve / waiting list (สำรอง) · co-admin · preset · import from message · realtime
- ✅ Itemized expenses + per-player PromptPay QR
- ✅ LINE billing (push bill + slip auto-verify: manual / BYOK)
- [ ] Recurring session
- [ ] Wheelspin / สุ่มรางวัล (deferred)

---

## Testing

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest (unit — pure logic: queue / scoring / bracket / divisions …)
npm run e2e         # @playwright/test — club happy path + A1/A4 (e2e/)
```

- **E2E** (`e2e/`) รัน **net-zero against prod** (โปรเจกต์มี Supabase เดียว): `global-setup` seed ก๊วน throwaway (marker `SMOKE_E2E_`) + mint `bc_session` cookie จาก `SESSION_SECRET`; `global-teardown` ลบทิ้งหมด. ต้องมี `.env.local` + dev server (auto-start/reuse :3000) · ครั้งแรก: `npx playwright install chromium`.
- **local-only** — ไม่อยู่ใน CI (CI = typecheck + vitest + build เท่านั้น; ยิง prod จาก CI ไม่ทำ).

## กฏการพัฒนา

- Forms: TanStack Form (`useForm` + `form.Field` + `form.Subscribe`)
- UI: shadcn/ui เท่านั้น
- Server actions: plain typed object (ไม่ใช่ FormData)
- Validation: client (TanStack) + server (zod) ทั้ง 2 ชั้น
- DB writes: service role key ผ่าน server actions (bypass RLS)
- After every task: update `spec.md`
