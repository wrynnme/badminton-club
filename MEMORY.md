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

<!-- entry ใหม่อยู่บนสุด — ยังไม่มีรายการ ลบ comment นี้เมื่อเพิ่ม entry แรก -->
