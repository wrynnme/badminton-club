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

  test("A1: 'ทุกสนาม' builds a match on every free court", async ({ page }) => {
    await page.goto(QUEUE_URL);
    await page.getByRole("button", { name: "ทุกสนาม" }).click();

    // 2 courts × singles(2) with 4 players → 2 pending matches
    await expect(page.getByRole("tab", { name: /รอแข่ง/ })).toContainText("2");

    const sb = adminClient();
    const { data } = await sb
      .from("club_matches")
      .select("court,status")
      .eq("club_id", E2E.clubId);
    const pending = (data ?? []).filter((m) => m.status === "pending");
    expect(pending.length).toBe(2);
    expect(new Set(pending.map((m) => m.court))).toEqual(new Set(E2E.courts));
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
      }
      await sb.from("club_presets").delete().eq("owner_id", E2E.ownerId).eq("name", presetName);
    }

    await cleanupGenerated();

    await sb
      .from("clubs")
      .update({
        promptpay_id: "0812345678",
        promptpay_name: "SMOKE_E2E_receiver",
        promptpay_qr_image: "https://example.com/smoke-qr.png",
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
        promptpay_qr_image: "https://example.com/smoke-qr.png",
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
        promptpay_qr_image: "https://example.com/smoke-qr.png",
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
    } finally {
      if (appliedClubId) {
        await sb.from("club_matches").delete().eq("club_id", appliedClubId);
        await sb.from("club_players").delete().eq("club_id", appliedClubId);
        await sb.from("club_admins").delete().eq("club_id", appliedClubId);
        await sb.from("club_expenses").delete().eq("club_id", appliedClubId);
        await sb.from("clubs").delete().eq("id", appliedClubId);
      }
      await sb.from("club_presets").delete().eq("owner_id", E2E.ownerId).eq("name", presetName);
    }
  });
});
