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

### ตอบ "ทำไมจำนวนผิด" จากโมเดลในหัว ไม่เช็ค locked pair ก่อน → over-claim (2026-07-14)
- **what**: user ถามว่าทำไมคนกลับก่อน (BANK) ได้แมตช์เกินเป้า. ผมบอกไป **2 รอบ** ว่า "กด รื้อ+สุ่มใหม่ แล้ว BANK จะเหลือตามเป้า 3" — จากการอ่านโค้ด generator/regenerate. พอ user บอกว่าทำแล้วไม่ได้ผล เลย query prod DB จริงถึงเจอว่า BANK ถูก **locked pair กับ Jxler** (คนเต็มเวลา เป้า 5) → คู่ล็อกลงด้วยกันทุกแมตช์ BANK เลย = 5 เป๊ะ. คำตอบเดิมผิด
- **root cause**: ตอบคำถาม data-accuracy ("ทำไมตัวเลขเป็นแบบนี้") จากการ reasoning โค้ดในหัว โดย**ไม่ query ข้อมูลจริง**ก่อน และ**ข้ามการเช็ค `club_locked_pairs`** ทั้งที่ memory rule (weird-pairing → เช็ค locked pair ก่อน) บอกไว้ชัด. เป้า pro-rate เป็น floor ไม่ใช่ cap — ผมเผลอ treat เป็น cap
- **correct**: คำถามแนว"ทำไม entity นี้ได้ค่า X" ในระบบจัดคิว/จับคู่ → **query prod จริงก่อนตอบ** (settings → roster+เวลา → **locked pairs** → match history) อย่าตอบจากโมเดลโค้ดในหัว; โดยเฉพาะเรื่องจำนวนแมตช์/คู่ ให้เช็ค `club_locked_pairs` เป็นอันดับต้นๆ เสมอ. ถ้ายังไม่ได้ยืนยันกับข้อมูลจริง อย่าพูดว่า "ทำ X แล้วจะได้ผล Y"

### เทสฟีเจอร์ด้วย config ที่ "ผ่านง่าย" ทำให้ over-claim ว่าใช้ได้ (2026-07-07)
- **what**: ทำฟีเจอร์ "สุ่มคิว variety" เสร็จ รายงานว่าเสร็จ+เขียว 806/806 tests. แต่พอ user ลองจริง (club 12 คน doubles N=10) กลับได้ 3 แมตช์วนซ้ำ 10 รอบ — variety ไม่ทำงานเลย. เทสที่เขียนไว้ใช้ 8 คน/N3 ซึ่ง**บังเอิญ**ไม่ trigger บั๊ก foursome-lock เลยผ่านหมด สร้างความมั่นใจผิดๆ
- **root cause**: เลือก config เทสที่สะดวก/ผ่านง่าย ไม่ได้เลือก config ที่ **adversarial ต่อหัวใจของฟีเจอร์** (จำนวนคนหารลงตัวกับขนาดแมตช์ + N สูง = เคสที่ variety โดนบีบมากที่สุด). ประกาศ "done" จาก green suite โดยไม่ได้พิสูจน์ว่า output จริงมี variety ตามที่ฟีเจอร์สัญญา
- **correct**: ฟีเจอร์ที่มี "หัวใจ" เป็นคุณสมบัติวัดได้ (variety, balance, fairness) → เขียน assertion ที่วัด**คุณสมบัตินั้นโดยตรง** (เช่น distinctPartnerships, maxRepeat) บน config ที่ adverse ที่สุด **ก่อน**บอก done; อย่าให้ green suite ที่ทดสอบเคสง่ายมาแทนการพิสูจน์ผลลัพธ์จริง. ถ้าเป็นอัลกอริทึม จับคู่/จัดคิว → ต้องมีเทส even-division + high-N เสมอ
- **what**: user สั่ง "ปิด dev server" (แอปบน :3000). `kill $(lsof -ti tcp:3000)` ไม่ตายสนิท (next dev มี process tree + respawn) เลยใช้ `pkill -9 -f "next-server"` ซึ่ง match **ทุก** next-server → เผลอฆ่า claude-smart dashboard (PID 61147 บน :3001) ที่ไม่เกี่ยวไปด้วย
- **root cause**: ใช้ name-pattern pkill ที่กว้าง ทั้งที่มีหลาย process ใช้ชื่อ binary เดียวกัน (`next-server`) — ไม่ได้จำกัดด้วย port/cwd/PID ที่เจาะจงเป้าหมาย
- **correct**: ปิด process ตาม **เป้าที่เจาะจง** — kill ตาม PID ที่ฟัง port เป้าหมาย (`lsof -ti tcp:<port>`) หรือ stop background task ที่ harness จัดการ; ถ้าจำเป็นต้อง pattern-match ให้รวม cwd/พอร์ตเข้าไปด้วย (เช่น เช็ค `lsof` ของ PID ก่อนฆ่า) **ห้าม `pkill -f "<binary-name>"` ลอยๆ** เมื่อมี process ชื่อซ้ำกันหลายตัวในเครื่อง
