import { test, expect } from "@playwright/test";
import { adminClient } from "./helpers/db";
import { E2E, QUEUE_URL, CLUB_URL } from "./helpers/fixtures";

// Club happy path + the two features added this cycle (A1 build-all, A4 over-time).
// Serial: every test builds on the shared seeded club's state.
test.describe.serial("club queue — happy path + A1 + A4", () => {
  test("loads the club authenticated (owner cookie)", async ({ page }) => {
    await page.goto(QUEUE_URL);
    await expect(page.getByRole("heading", { name: E2E.clubName })).toBeVisible();
    // owner identity from the minted cookie
    await expect(page.getByRole("button", { name: new RegExp(E2E.ownerName) })).toBeVisible();
  });

  test("roster level quick-select persists to the player row", async ({ page }) => {
    const sb = adminClient();
    const { data: levels, error: levelsError } = await sb
      .from("levels")
      .select("id,label,real,sort_order")
      .is("club_id", null)
      .order("sort_order", { ascending: true });
    expect(levelsError).toBeNull();

    const level = levels?.find((row) => row.label === "N") ?? levels?.[0];
    expect(level).toBeTruthy();

    await page.goto(CLUB_URL);
    await page.getByRole("tab", { name: "ลงชื่อ / เช็คอิน" }).click();
    await page
      .getByRole("combobox", { name: `ตั้งระดับให้ ${E2E.players[0]}` })
      .click();
    await page.getByRole("option", { name: `${level!.label} (${level!.real})` }).click();
    await expect(page.getByText("บันทึกระดับแล้ว")).toBeVisible();

    const { data: player, error: playerError } = await sb
      .from("club_players")
      .select("level_id")
      .eq("club_id", E2E.clubId)
      .eq("display_name", E2E.players[0])
      .single();
    expect(playerError).toBeNull();
    expect(player?.level_id).toBe(level!.id);
  });

  test("สุ่มคิว: generates courtless matches; start blocked until a court is assigned", async ({ page }) => {
    await page.goto(QUEUE_URL);
    await page.getByRole("button", { name: "สุ่มคิว" }).click();

    // N = 1 → 4 players singles → 2 matches covering everyone once
    const minInput = page.getByRole("spinbutton").first();
    await minInput.fill("1");
    await page.getByRole("dialog").getByRole("button", { name: "สุ่มคิว" }).click();
    await expect(page.getByText(/สุ่มคิวแล้ว 2 แมตช์/)).toBeVisible();
    await expect(page.getByRole("tab", { name: /รอแข่ง/ })).toContainText("2");

    // Generated rows are courtless in the DB…
    const sb = adminClient();
    const { data, error } = await sb
      .from("club_matches")
      .select("court,status")
      .eq("club_id", E2E.clubId);
    expect(error).toBeNull();
    const pending = (data ?? []).filter((m) => m.status === "pending");
    expect(pending.length).toBe(2);
    expect(pending.every((m) => m.court === null)).toBe(true);

    // …so every start button is the disabled "needs court" variant.
    const needCourtButtons = page.getByRole("button", { name: "ต้องเลือกสนามก่อนเริ่ม" });
    await expect(needCourtButtons).toHaveCount(2);
    await expect(needCourtButtons.first()).toBeDisabled();

    // Assign a court to each row. Target by index (nth) — "first unassigned"
    // is unstable because the row's Select can render stale between the server
    // write and the router refresh, which would retarget row 1 twice.
    for (let i = 0; i < 2; i++) {
      await page.getByRole("combobox", { name: "เปลี่ยนสนาม" }).nth(i).click();
      await page.getByRole("option", { name: `สนาม ${E2E.courts[i]}`, exact: true }).click();
      await expect
        .poll(async () => {
          const { data: rows } = await sb
            .from("club_matches")
            .select("court")
            .eq("club_id", E2E.clubId)
            .eq("status", "pending")
            .not("court", "is", null);
          return (rows ?? []).length;
        })
        .toBe(i + 1);
    }

    const { data: after } = await sb
      .from("club_matches")
      .select("court")
      .eq("club_id", E2E.clubId)
      .eq("status", "pending");
    expect(new Set((after ?? []).map((m) => m.court))).toEqual(new Set(E2E.courts));
    await page.reload();
    await expect(page.getByRole("button", { name: /เริ่มแมตช์/ }).first()).toBeEnabled();
  });

  test("จัดคิวใหม่: re-roll keeps court + queue position", async ({ page }) => {
    const sb = adminClient();
    const { data: before, error } = await sb
      .from("club_matches")
      .select("id,court,queue_position")
      .eq("club_id", E2E.clubId)
      .eq("status", "pending")
      .order("queue_position");
    expect(error).toBeNull();
    expect((before ?? []).length).toBe(2);
    const target = before![1];

    await page.goto(QUEUE_URL);
    await page.getByRole("button", { name: "จัดคิวใหม่" }).last().click();
    await expect(page.getByText("จัดคิวใหม่แล้ว")).toBeVisible();

    const { data: after, error: afterError } = await sb
      .from("club_matches")
      .select("id,court,queue_position")
      .eq("id", target.id)
      .single();
    expect(afterError).toBeNull();
    expect(after?.court).toBe(target.court);
    expect(after?.queue_position).toBe(target.queue_position);
  });

  test("A4: in-progress match shows 'เกินเวลา' once past game_time_limit", async ({ page }) => {
    const sb = adminClient();

    // start one pending match via the UI
    await page.goto(QUEUE_URL);
    await page.getByRole("button", { name: /เริ่มแมตช์/ }).first().click();
    await expect(page.getByRole("tab", { name: /กำลังแข่ง/ })).toContainText("1");

    // backdate beyond the 1-min limit (deterministic — no real wait), reload, assert badge
    await sb
      .from("club_matches")
      .update({ started_at: new Date(Date.now() - 2 * 60 * 1000).toISOString() })
      .eq("club_id", E2E.clubId)
      .eq("status", "in_progress");

    await page.goto(QUEUE_URL);
    await page.getByRole("tab", { name: /กำลังแข่ง/ }).click();
    await expect(page.getByText("เกินเวลา")).toBeVisible();
  });

  test("finish the match → moves to จบแล้ว", async ({ page }) => {
    await page.goto(QUEUE_URL);
    await page.getByRole("tab", { name: /กำลังแข่ง/ }).click();
    await page.getByRole("button", { name: /จบแข่ง/ }).first().click();
    // winner-only finish (no per-set score required)
    await page.getByRole("button", { name: /ฝั่ง A ชนะ/ }).click();
    await expect(page.getByRole("tab", { name: /จบแล้ว/ })).toContainText("1");

    const sb = adminClient();
    const { data } = await sb
      .from("club_matches")
      .select("status,winner_side")
      .eq("club_id", E2E.clubId)
      .eq("status", "completed");
    expect((data ?? []).length).toBe(1);
    expect(data?.[0]?.winner_side).toBe("a");
  });

  test("winner chain: placeholder renders → finishing the feeder fills the target", async ({ page }) => {
    const sb = adminClient();

    // Clear leftover pendings so the feeder's start button is unambiguous.
    await sb.from("club_matches").delete().eq("club_id", E2E.clubId).eq("status", "pending");

    const { data: playerRows, error: playersError } = await sb
      .from("club_players")
      .select("id, display_name")
      .eq("club_id", E2E.clubId);
    expect(playersError).toBeNull();
    const idOf = (name: string) => playerRows!.find((p) => p.display_name === name)!.id as string;
    const [p1, p2, p3] = [idOf(E2E.players[0]), idOf(E2E.players[1]), idOf(E2E.players[2])];

    // Feeder (court 1, p1 vs p2) → target (courtless; side A = winner placeholder, side B = p3).
    const { data: target, error: targetError } = await sb
      .from("club_matches")
      .insert({
        club_id: E2E.clubId,
        court: null,
        side_a_player1: null,
        side_b_player1: p3,
        status: "pending",
        queue_position: 21,
      })
      .select("id")
      .single();
    expect(targetError).toBeNull();
    const { data: feeder, error: feederError } = await sb
      .from("club_matches")
      .insert({
        club_id: E2E.clubId,
        court: E2E.courts[0],
        side_a_player1: p1,
        side_b_player1: p2,
        status: "pending",
        queue_position: 20,
        winner_next_match_id: target!.id,
        winner_next_match_slot: "a",
      })
      .select("id")
      .single();
    expect(feederError).toBeNull();

    // Placeholder side renders + the target can't start (waiting for the winner).
    await page.goto(QUEUE_URL);
    await expect(page.getByText(/ผู้ชนะจากคิวที่ 20/)).toBeVisible();

    // Start + finish the feeder with side A (p1) winning → promotion fires in the RPC.
    await page.getByRole("button", { name: /เริ่มแมตช์/ }).first().click();
    await expect(page.getByRole("tab", { name: /กำลังแข่ง/ })).toContainText("1");
    await page.getByRole("tab", { name: /กำลังแข่ง/ }).click();
    await page.getByRole("button", { name: /จบแข่ง/ }).first().click();
    await page.getByRole("button", { name: /ฝั่ง A ชนะ/ }).click();

    await expect
      .poll(async () => {
        const { data: filled } = await sb
          .from("club_matches")
          .select("side_a_player1")
          .eq("id", target!.id)
          .single();
        return filled?.side_a_player1 ?? null;
      })
      .toBe(p1);

    // Placeholder badge is gone once the side is real players.
    await page.goto(QUEUE_URL);
    await expect(page.getByText(/ผู้ชนะจากคิวที่/)).toHaveCount(0);

    // Cleanup the chain rows (keep the club reusable for the remaining tests).
    await sb.from("club_matches").delete().in("id", [feeder!.id, target!.id]);
  });

  test("cost tab renders without error", async ({ page }) => {
    await page.goto(CLUB_URL);
    await page.getByRole("tab", { name: "ค่าใช้จ่าย" }).click();
    await expect(page.getByRole("heading", { name: E2E.clubName })).toBeVisible();
  });

  test("save current club as preset carries payment receiver through apply", async ({ page }) => {
    const sb = adminClient();
    const presetName = `${E2E.marker}payment_preset`;
    let appliedClubId: string | null = null;

    async function cleanupGenerated() {
      const { data: generatedClubs } = await sb
        .from("clubs")
        .select("id")
        .eq("owner_id", E2E.ownerId)
        .eq("name", presetName);
      const generatedIds = (generatedClubs ?? []).map((club) => club.id as string);
      if (generatedIds.length > 0) {
        await sb.from("club_matches").delete().in("club_id", generatedIds);
        await sb.from("club_players").delete().in("club_id", generatedIds);
        await sb.from("club_admins").delete().in("club_id", generatedIds);
        await sb.from("club_expenses").delete().in("club_id", generatedIds);
        await sb.from("clubs").delete().in("id", generatedIds);
        await sb.storage.from("club-qr").remove(generatedIds.map((id) => `${id}/promptpay`));
      }
      await sb.from("club_presets").delete().eq("owner_id", E2E.ownerId).eq("name", presetName);
    }

    await cleanupGenerated();

    // Upload a real storage object so the apply-path QR copy is exercised
    // end-to-end (apply copies the object to the new club's own path instead
    // of sharing the source club's mutable URL).
    const sourceQrPath = `${E2E.clubId}/promptpay`;
    const up = await sb.storage
      .from("club-qr")
      .upload(sourceQrPath, Buffer.from("smoke-e2e-qr-bytes"), {
        contentType: "image/png",
        upsert: true,
      });
    expect(up.error).toBeNull();
    const { data: sourceQrPub } = sb.storage.from("club-qr").getPublicUrl(sourceQrPath);
    const sourceQrUrl = `${sourceQrPub.publicUrl}?v=e2e`;

    await sb
      .from("clubs")
      .update({
        promptpay_id: "0812345678",
        promptpay_name: "SMOKE_E2E_receiver",
        promptpay_qr_image: sourceQrUrl,
        receipt_template: {
          footer_note: "not copied to preset",
          fields: { court: false, shuttle: true, expense: true, discount: true },
          payment_show: { promptpay: true, bank: true },
          bank: {
            name: "SCB",
            account_no: "123-4-56789-0",
            account_name: "SMOKE_E2E_receiver",
          },
          theme: "blue",
          bank_qr: false,
        },
      })
      .eq("id", E2E.clubId);

    try {
      await page.goto(`${CLUB_URL}?tab=settings`);
      await page.getByRole("button", { name: "บันทึกเป็นพรีเซ็ต" }).click();
      await page.getByLabel("ชื่อพรีเซ็ต").fill(presetName);
      await page.getByRole("button", { name: "สร้างพรีเซ็ต" }).click();
      await expect(page.getByText("สร้างพรีเซ็ตแล้ว")).toBeVisible();

      const { data: preset, error: presetError } = await sb
        .from("club_presets")
        .select("id, config")
        .eq("owner_id", E2E.ownerId)
        .eq("name", presetName)
        .single();
      expect(presetError).toBeNull();
      expect(preset?.config).toMatchObject({
        promptpay_id: "0812345678",
        promptpay_name: "SMOKE_E2E_receiver",
        // Save-as-preset snapshots the source URL verbatim...
        promptpay_qr_image: sourceQrUrl,
        receipt_template: {
          payment_show: { promptpay: true, bank: true },
          bank: {
            name: "SCB",
            account_no: "123-4-56789-0",
            account_name: "SMOKE_E2E_receiver",
          },
          theme: "blue",
        },
      });

      await page.goto("/clubs/mine");
      const presetCard = page
        .locator('[data-slot="card"]')
        .filter({ hasText: presetName })
        .first();
      await presetCard.getByRole("button", { name: "เปิดก๊วน" }).click();
      await expect(page).toHaveURL(/\/clubs\/[0-9a-f-]+/);
      appliedClubId = page.url().match(/\/clubs\/([0-9a-f-]+)/)?.[1] ?? null;
      expect(appliedClubId).toBeTruthy();

      const { data: applied, error: appliedError } = await sb
        .from("clubs")
        .select("promptpay_id, promptpay_name, promptpay_qr_image, receipt_template")
        .eq("id", appliedClubId)
        .single();
      expect(appliedError).toBeNull();
      expect(applied).toMatchObject({
        promptpay_id: "0812345678",
        promptpay_name: "SMOKE_E2E_receiver",
        receipt_template: {
          payment_show: { promptpay: true, bank: true },
          bank: {
            name: "SCB",
            account_no: "123-4-56789-0",
            account_name: "SMOKE_E2E_receiver",
          },
          theme: "blue",
        },
      });
      // ...but apply gives the new club its OWN storage object — never the
      // source club's mutable URL (source replace/delete must not affect it).
      expect(applied?.promptpay_qr_image).toContain(`/club-qr/${appliedClubId}/promptpay`);
      const copied = await sb.storage.from("club-qr").download(`${appliedClubId}/promptpay`);
      expect(copied.error).toBeNull();
    } finally {
      if (appliedClubId) {
        await sb.from("club_matches").delete().eq("club_id", appliedClubId);
        await sb.from("club_players").delete().eq("club_id", appliedClubId);
        await sb.from("club_admins").delete().eq("club_id", appliedClubId);
        await sb.from("club_expenses").delete().eq("club_id", appliedClubId);
        await sb.from("clubs").delete().eq("id", appliedClubId);
        await sb.storage.from("club-qr").remove([`${appliedClubId}/promptpay`]);
      }
      await sb.storage.from("club-qr").remove([sourceQrPath]);
      await sb.from("club_presets").delete().eq("owner_id", E2E.ownerId).eq("name", presetName);
    }
  });
});
