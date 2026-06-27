# MEMORY — agent operational failures (ก๊วนแบด)

บันทึก **pattern failure / operational mistake ของ agent เอง** เพื่อไม่ทำซ้ำใน session ถัดไป.
ไฟล์นี้ถูกโหลด auto ทุก session ผ่าน `@MEMORY.md` ใน `CLAUDE.md`.

**ขอบเขต — อย่าสับสนกับไฟล์อื่น:**
- `MEMORY.md` (ไฟล์นี้) = ความผิดพลาด **เชิงกระบวนการของ AI** เช่น ถาม permission กับงาน R2, บอก "done" โดยไม่ได้รัน verify, เดา path, wire แค่ฝั่งเดียวของ pipeline.
- `bug.md` = บั๊กของ **โค้ด/ผลิตภัณฑ์** (P0/P1/P2, repro, fix).
- `spec.md` = สถานะโปรเจกต์ (architecture / current state / contracts / done / todo).

## วิธีเขียน entry (3 ฟิลด์บังคับ)

ทุก entry ต้องมี 3 ฟิลด์ — entry ใหม่อยู่บนสุด:

```markdown
### หัวข้อสั้น (YYYY-MM-DD)
- **what**: เกิดอะไรขึ้น (ข้อเท็จจริง ไม่ใช่ความรู้สึก)
- **root cause**: สาเหตุราก (ทำไมถึงพลาด ไม่ใช่แค่ "พลาด")
- **correct**: พฤติกรรมที่ถูกต้อง — เขียนเป็น "คำสั่งที่ทำตามได้" ไม่ใช่ความรู้สึก
```

correct behavior ต้องเป็นคำสั่งที่ทำตามได้จริง เช่น "ถ้าเป็น R2 → ทำเลยแล้วรายงาน ไม่ต้องถาม" ไม่ใช่ "ควรระวังมากขึ้น".

---

## Log

### แก้ `.storybook/main.ts` ขณะ dev server รัน แต่ลืม restart → ผู้ใช้เจอ error ที่ verify ไม่เจอ (2026-06-27)
- **what**: เพิ่ม `viteFinal` alias (mock server action) ใน `.storybook/main.ts` *หลัง* Storybook dev server (:6006) รันอยู่แล้ว. vitest story test ผ่าน 23/23 เลยรายงานว่าเสร็จ — แต่ MatchRow บน dev server UI พังจริง (`Module "crypto" has been externalized` เพราะลาก real server action) ผู้ใช้เป็นคนเจอ error เอง
- **root cause**: Vite/Storybook dev server โหลด `main.ts` (builder/framework/viteFinal config) ตอน start เท่านั้น — แก้ config ระหว่างรัน **ไม่ trigger HMR/reload** (ต่างจาก `preview.tsx`/stories ที่ HMR ได้). ผม verify ผ่าน vitest ซึ่งเป็น process แยกที่อ่าน config สดทุกครั้ง → ไม่สะท้อนสภาพ dev server ที่ค้าง config เก่า → false "เสร็จแล้ว"
- **correct**: เมื่อแก้ `.storybook/main.ts` (addons / framework / `viteFinal` / builder) ขณะ dev server รัน → **restart dev server เสมอ** (kill เจาะจง PID storybook tree + start ใหม่). อย่า assume "vitest เขียว = dev server UI ok" สำหรับการเปลี่ยน config — vitest อ่าน config สด แต่ long-running dev server cache ของเก่า. `preview.tsx`/stories แก้สดได้ (HMR), `main.ts` ต้อง restart

### pkill กว้างเกินไปฆ่า process ที่ไม่เกี่ยว (2026-06-26)
- **what**: user สั่ง "ปิด dev server" (แอปบน :3000). `kill $(lsof -ti tcp:3000)` ไม่ตายสนิท (next dev มี process tree + respawn) เลยใช้ `pkill -9 -f "next-server"` ซึ่ง match **ทุก** next-server → เผลอฆ่า claude-smart dashboard (PID 61147 บน :3001) ที่ไม่เกี่ยวไปด้วย
- **root cause**: ใช้ name-pattern pkill ที่กว้าง ทั้งที่มีหลาย process ใช้ชื่อ binary เดียวกัน (`next-server`) — ไม่ได้จำกัดด้วย port/cwd/PID ที่เจาะจงเป้าหมาย
- **correct**: ปิด process ตาม **เป้าที่เจาะจง** — kill ตาม PID ที่ฟัง port เป้าหมาย (`lsof -ti tcp:<port>`) หรือ stop background task ที่ harness จัดการ; ถ้าจำเป็นต้อง pattern-match ให้รวม cwd/พอร์ตเข้าไปด้วย (เช่น เช็ค `lsof` ของ PID ก่อนฆ่า) **ห้าม `pkill -f "<binary-name>"` ลอยๆ** เมื่อมี process ชื่อซ้ำกันหลายตัวในเครื่อง
