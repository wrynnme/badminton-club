# 🏸 ก๊วนแบด (Badminton Club)

ระบบจัดก๊วนตีแบด — สร้างก๊วนของตัวเอง / ลงชื่อเล่นก๊วนคนอื่น

**Stack**: Next.js 16 (App Router) · Tailwind v4 · shadcn/ui · TanStack Form v1 · Supabase · LINE Login · Google Font Anuphan

## กฏการพัฒนา

- Forms ทุกอันใช้ **TanStack Form** (`useForm`, `form.Field`, `form.Subscribe`)
- UI components ใช้ **shadcn/ui** เท่านั้น — ห้ามเขียน HTML form element เปล่า
- Server actions รับ **plain object** (ไม่ใช่ FormData)
- Validation ทำ 2 ชั้น: client (TanStack validators) + server (zod)

---

## ฟีเจอร์ MVP

- ✅ สร้างก๊วน + แก้ไขข้อมูลก๊วน (เจ้าของ)
- ✅ เจ้าของตั้งค่าก๊วนรวมหลังจบ → ระบบคำนวณค่า/คนอัตโนมัติ
- ✅ Browse ก๊วนทั้งหมด
- ✅ ลงชื่อเล่น + ถอนชื่อ (มี capacity check)
- ✅ เจ้าของถอนชื่อผู้เล่นได้ (kick)
- ✅ Drag & drop จัดลำดับรายชื่อ (เจ้าของ)
- ✅ Auto-refresh รายชื่อทุก 30 วิ + ปุ่มรีเฟรช
- ✅ Auth: LINE Login + Guest mode + redirect หลัง login
- ✅ Dark/Light theme toggle

---

## 1. ติดตั้ง

```bash
npm install
cp .env.example .env.local
```

แก้ `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

LINE_CHANNEL_ID=...
LINE_CHANNEL_SECRET=...
LINE_REDIRECT_URI=http://localhost:3000/api/auth/line/callback

NEXT_PUBLIC_APP_URL=http://localhost:3000
SESSION_SECRET=<random 32+ chars — เช่น openssl rand -hex 32>
```

---

## 2. Setup Supabase

1. สร้าง project: https://app.supabase.com
2. Settings → API → คัดลอก URL, publishable key, service_role key ใส่ `.env.local`
3. รัน schema ผ่าน Claude Code (มี MCP อยู่แล้ว): บอก Claude ให้ `apply_migration` จากไฟล์ `supabase/schema.sql`
   หรือจะรันเองที่ SQL Editor ก็ได้

> หมายเหตุ: ตอนนี้ writes ใช้ service role key ผ่าน server actions. RLS เปิด select policy ให้ทุกคนอ่านได้ — เพิ่ม policy ภายหลังเมื่อย้ายไปใช้ Supabase Auth

---

## 2.5 Supabase MCP + Agent Skills (Claude Code)

`.mcp.json` อยู่ใน repo แล้ว — Claude Code จะเชื่อม Supabase อัตโนมัติ

ติดตั้ง agent skills เพื่อให้ Claude รู้จัก Postgres best practices:

```bash
npx skills add supabase/agent-skills
```

> `.agents/` ถูก gitignore ไว้ — แต่ละคนต้อง install เอง

---

## 3. Setup LINE Login (optional)

ถ้ายังไม่พร้อม ใช้ guest mode ได้เลย — ข้ามขั้นตอนนี้

1. https://developers.line.biz/console/ → สร้าง Provider + Channel (LINE Login)
2. App settings:
   - Callback URL: `http://localhost:3000/api/auth/line/callback`
   - Scopes: `profile`, `openid`
3. คัดลอก Channel ID + Channel secret ใส่ `.env.local`

---

## 4. Run

```bash
npm run dev
```

เปิด http://localhost:3000

---

## โครงสร้าง

```
src/
├── app/
│   ├── page.tsx                       # Login (LINE / Guest)
│   ├── clubs/
│   │   ├── page.tsx                   # List clubs
│   │   ├── new/page.tsx               # Create club
│   │   └── [id]/page.tsx              # Club detail + join
│   ├── tournaments/
│   │   ├── page.tsx                   # Tournament list
│   │   ├── new/page.tsx               # Create tournament
│   │   └── [id]/page.tsx              # Tournament detail + stages
│   └── api/auth/
│       ├── line/route.ts              # OAuth start
│       ├── line/callback/route.ts     # OAuth callback
│       ├── guest/route.ts             # Guest signup
│       └── logout/route.ts
├── components/
│   ├── site-header.tsx
│   ├── theme-toggle.tsx
│   ├── club/
│   │   ├── create-form.tsx
│   │   ├── edit-club-form.tsx
│   │   ├── join-form.tsx
│   │   ├── kick-button.tsx
│   │   ├── leave-button.tsx
│   │   ├── set-total-cost-form.tsx
│   │   └── sortable-player-list.tsx
│   ├── tournament/
│   │   ├── create-tournament-form.tsx  # TanStack Form + zod, incl. match_unit
│   │   ├── team-manager.tsx            # Teams + members (level, rename inline)
│   │   ├── group-stage.tsx             # Gen groups, gen matches, standings
│   │   ├── pair-stage.tsx              # Pair manager + matches + dual standings
│   │   ├── pair-manager.tsx            # Create/delete pairs (player_id_1/2, level badge)
│   │   ├── knockout-stage.tsx          # Upper/lower/grand_final bracket sections
│   │   ├── csv-import-dialog.tsx       # 2-step: import players then pairs via csv_id
│   │   ├── export-buttons.tsx          # Export matches/roster + download templates
│   │   ├── tournament-status-control.tsx
│   │   ├── match-row.tsx               # Single match row (score + reset)
│   │   ├── score-form.tsx              # Games array entry (21-15, 21-19 …)
│   │   └── standings-table.tsx         # P/W/D/L/+−/Pts table
│   └── ui/                             # shadcn
├── lib/
│   ├── supabase/{client,server}.ts
│   ├── auth/session.ts                 # HMAC-signed cookie
│   ├── actions/
│   │   ├── clubs.ts                    # Club server actions
│   │   ├── tournaments.ts              # Tournament CRUD + CSV import actions
│   │   ├── matches.ts                  # Generate groups/matches/bracket, record scores
│   │   └── pairs.ts                    # Create/delete pairs (flat player_id_1/2)
│   ├── tournament/
│   │   ├── competitor.ts               # Competitor abstraction (Team | Pair)
│   │   ├── scheduling.ts               # Balanced round-robin pair scheduling
│   │   ├── scoring.ts                  # computeStandings, leaguePoints, gameWinner
│   │   └── bracket.ts                  # buildBracket, buildDoubleBracket, roundLabel
│   ├── export/
│   │   └── csv.ts                      # generateMatchesCsv, generateRosterCsv, templates
│   └── types.ts
└── supabase/schema.sql                 # DB schema
```

---

## Roadmap

### ก๊วนแบด

- [ ] Cancel ก๊วน (เจ้าของเท่านั้น)
- [ ] Waiting list เมื่อก๊วนเต็ม
- [ ] Notify ผ่าน LINE (Messaging API)
- [ ] Recurring ก๊วน (ทุกพุธ/อังคาร)
- ✅ ตั้งค่าก๊วนรวม / คำนวณค่า/คน
- [ ] Payment status (จ่ายแล้ว/ยังไม่จ่าย)
- [ ] ระบบ rating / level
- [ ] Real-time updates (Supabase Realtime)
- [ ] PWA + push notification

### Tournament System

**โหมดกีฬาสี** (Phase 0–4 เสร็จแล้ว)

- ✅ Phase 0 — Coming Soon page สำหรับ competition mode
- ✅ Phase 1 — CRUD tournaments + teams + members (captain/member roles)
- ✅ Phase 2 — Group stage (team mode) + Pair stage (pair mode): gen matches + score entry + standings
- ✅ Phase 3 — Knockout: single-elimination bracket, BYE auto-advance, winner auto-advance, tournament status control
- ✅ Phase 4 — Double-elimination bracket + pair mode KO + CSV import/export + player level
- [ ] Phase 5 — Bracket visualization (visual tree diagram)
- [ ] Phase 6 — Realtime updates + public share link (`/t/[token]`)
- [ ] Phase 7 — LINE notification (Messaging API) + export PDF

**โหมดแข่งขัน** (Coming Soon)

**match_unit:**

- `team` — ทีม vs ทีม (group stage)
- `pair` — คู่ vs คู่ (จับคู่ภายในทีมก่อน → round-robin ข้ามทีม)

**Formats:**

- `group_only` — แบ่งกลุ่ม เจอกันหมดในสาย
- `group_knockout` — แบ่งกลุ่ม → top N เข้า knockout (กำหนด advance_count ต่อกลุ่ม)
- `knockout_only` — single elimination (seed จากทีมทั้งหมด)

**Scoring:**

- League: Win = 3 pts, Draw = 1 pt, Loss = 0 pts
- Match score: ป้อนเป็น games array (21-15, 21-19 …) — winner คำนวณจาก games ชนะมากกว่า
- Standings: P / W / D / L / +− / Pts; tie-break = point diff → points for

**Pair system (flat schema):**

- `pairs` table: `player_id_1`, `player_id_2`, `display_pair_name` — ไม่มี junction table
- 1-person-1-pair enforced by OR query ก่อน insert
- Players มี `level` (S/A/B/C/D/N หรือ custom) + `csv_id` สำหรับ import

**CSV import (2-step):**

- Step 1 players: `team, color, id_player, display_name, role, level` — upsert by csv_id
- Step 2 pairs: `id_player, pair_name` — lookup player UUID จาก csv_id

**Knockout bracket (Phase 3+4):**

- Standard single-elimination: seed 1 เจอ seed 2 ได้เฉพาะรอบชิง
- Double-elimination: upper losers → lower bracket via `loser_next_match_id`
- `allow_drop_to_lower=false`: lower bracket pre-seeded จาก 3rd/4th per group
- Grand final: upper winner vs lower winner (single match, no bracket reset)
- BYE auto-complete; winner + loser both auto-advance; reset blocked if next match จบ

**Seeding:** random draw หรือ by group score
