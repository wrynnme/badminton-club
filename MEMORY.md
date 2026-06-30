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

### pkill กว้างเกินไปฆ่า process ที่ไม่เกี่ยว (2026-06-26)
- **what**: user สั่ง "ปิด dev server" (แอปบน :3000). `kill $(lsof -ti tcp:3000)` ไม่ตายสนิท (next dev มี process tree + respawn) เลยใช้ `pkill -9 -f "next-server"` ซึ่ง match **ทุก** next-server → เผลอฆ่า claude-smart dashboard (PID 61147 บน :3001) ที่ไม่เกี่ยวไปด้วย
- **root cause**: ใช้ name-pattern pkill ที่กว้าง ทั้งที่มีหลาย process ใช้ชื่อ binary เดียวกัน (`next-server`) — ไม่ได้จำกัดด้วย port/cwd/PID ที่เจาะจงเป้าหมาย
- **correct**: ปิด process ตาม **เป้าที่เจาะจง** — kill ตาม PID ที่ฟัง port เป้าหมาย (`lsof -ti tcp:<port>`) หรือ stop background task ที่ harness จัดการ; ถ้าจำเป็นต้อง pattern-match ให้รวม cwd/พอร์ตเข้าไปด้วย (เช่น เช็ค `lsof` ของ PID ก่อนฆ่า) **ห้าม `pkill -f "<binary-name>"` ลอยๆ** เมื่อมี process ชื่อซ้ำกันหลายตัวในเครื่อง
