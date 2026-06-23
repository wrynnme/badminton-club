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
});
