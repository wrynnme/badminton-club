# ก๊วนแบด (Badminton Club)

ระบบจัดก๊วนตีแบด + จัดการทัวร์นาเมนต์กีฬาสี

**Stack**: Next.js 16 App Router · Tailwind v4 · shadcn/ui · TanStack Form v1 · Supabase · LINE Login · Anuphan font

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

### Pair Division (กลุ่มบน/ล่าง)

ตั้งค่า `pair_division_threshold` ต่อ tournament:
- `null` = ไม่แบ่ง (ทุกคู่เจอกัน)
- ตัวเลข N = `pair_level > N` → กลุ่มบน; `≤ N` → กลุ่มล่าง
- กลุ่มบน/ล่างไม่เจอกันในรอบแบ่งกลุ่ม — เจอกันได้ในรอบ knockout

### Level

Free numeric (เช่น `3`, `3.5`, `7`) — ไม่มี fixed scale ทั้ง player level และ pair_level

### CSV Import (2-step)

**Step 1 — ผู้เล่น**

```
team, color, id_player*, display_name*, role, level
```

- upsert by `id_player` (csv_id) — ถ้าซ้ำ → update; ใหม่ → insert
- auto-create team ถ้าไม่มี

**Step 2 — จับคู่**

```
team, pair_code*, id_player_1*, id_player_2*, pair_name, pair_level
```

- `pair_code` required
- upsert by `pair_code` — ถ้าซ้ำ → update; ใหม่ → insert
- `team` column เป็น informational เท่านั้น — team validate จาก player membership

### CSV Export

- **ผลแข่งขัน** — match results
- **รายชื่อ** — roster (ทีม, id_player, ชื่อ, level, pair_code, คู่, pair_level)
- **Template ผู้เล่น** — blank template
- **Template จับคู่** — pre-filled จาก player csv_ids ที่มีอยู่

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
│   ├── page.tsx                        # Login (LINE / Guest)
│   ├── clubs/                          # ก๊วนแบด
│   ├── tournaments/
│   │   ├── page.tsx                    # Tournament list
│   │   ├── new/page.tsx                # Create
│   │   └── [id]/page.tsx               # Detail + stages
│   └── api/auth/                       # LINE OAuth + guest + logout
├── components/
│   ├── tournament/
│   │   ├── create-tournament-form.tsx  # incl. pair_division_threshold
│   │   ├── team-manager.tsx            # Teams + members (numeric level, inline rename)
│   │   ├── pair-manager.tsx            # Create/delete pairs (pair_code, pair_level)
│   │   ├── pair-stage.tsx              # Pair matches + division standings
│   │   ├── group-stage.tsx             # Team mode group stage
│   │   ├── knockout-stage.tsx          # Upper / lower / grand_final sections
│   │   ├── csv-import-dialog.tsx       # 2-step CSV import (players + pairs)
│   │   ├── export-buttons.tsx          # Export matches/roster + templates
│   │   ├── match-row.tsx
│   │   ├── score-form.tsx
│   │   └── standings-table.tsx
│   └── ui/                             # shadcn/ui
└── lib/
    ├── actions/
    │   ├── tournaments.ts              # CRUD + importPlayersCsvAction + importPairsCsvAction
    │   ├── matches.ts                  # generatePairMatchesAction (division-aware)
    │   └── pairs.ts                    # createPairAction (pair_code, pair_level)
    ├── tournament/
    │   ├── bracket.ts                  # buildBracket, buildDoubleBracket
    │   ├── scheduling.ts               # generateAllPairMatches
    │   └── scoring.ts                  # computeStandings
    ├── export/csv.ts                   # generateMatchesCsv, generateRosterCsv, templates
    └── types.ts
```

---

## Roadmap

### Tournament System

- ✅ Phase 0–4 — CRUD · group stage · pair mode · double elimination · CSV import/export · player/pair level · pair_code · configurable division threshold
- [ ] Phase 5 — Bracket visualization
- [ ] Phase 6 — Realtime + public share link (`/t/[token]`)
- [ ] Phase 7 — LINE notification + PDF export

### ก๊วนแบด

- [ ] Waiting list
- [ ] LINE notification
- [ ] Recurring session
- [ ] Payment status

---

## กฏการพัฒนา

- Forms: TanStack Form (`useForm` + `form.Field` + `form.Subscribe`)
- UI: shadcn/ui เท่านั้น
- Server actions: plain typed object (ไม่ใช่ FormData)
- Validation: client (TanStack) + server (zod) ทั้ง 2 ชั้น
- DB writes: service role key ผ่าน server actions (bypass RLS)
- After every task: update `spec.md`
