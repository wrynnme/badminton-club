import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "./helpers/db";
import { T5, T5_QUEUE_URL, seedT5, teardownT5, resetT5, fetchT5 } from "./helpers/tournament-fixtures";

// T5 race-hardening — deterministic adversarial races on the tournament queue.
// DB-level rounds fire truly concurrent RPC calls (Promise.all against the same
// Supabase the app uses); the browser round drives two live admin tabs.
// The browser test runs FIRST — the DB rounds hammer hundreds of row updates
// through the WAL, and running them before the browser test can delay Realtime
// delivery beyond the poll windows.
//
// Invariants asserted:
//   I1  match_number stays a permutation of 1..8 (no dup, no hole, no drift)
//   I2  concurrent full-list reorders serialize — final order equals exactly
//       one caller's submitted order, never an interleaved mix
//   I3  at most one in_progress match per court (partial unique index)
//   I4  a match can be started exactly once
//   I5  two live tabs converge to the same order after a mid-drag conflict
//   I6  a match's number never changes after start_match_atomic returns ok
//       (renumber-while-pending then start is legal; renumber mid-game is not)
//
// History: the first run of I5 exposed a P1 — `tournaments` was missing from
// the supabase_realtime publication, which silently killed the WHOLE page-level
// channel (matches binding included), so TournamentLiveWrapper's debounced
// refresh never fired anywhere. Fixed by migration
// 20260704000100_add_tournaments_to_realtime_publication.
//
// R2 history: originally a known-gap probe — swap_pending_match_numbers
// validated "all pending" BEFORE its renumber passes, so a start committing
// inside that window renumbered an in_progress match (26/30 incidence).
// Closed by migration 20260704000200_swap_pending_lock_rows_before_validate
// (FOR UPDATE row locks before validation): now either the swap commits first
// and the blocked start begins with the new number, or the start commits first
// and the swap cleanly rejects. R2 asserts the hard invariant I6.

const ROUNDS = 20;
const WINDOW_ROUNDS = 30;

const swap = (sb: SupabaseClient, ids: readonly string[]) =>
  sb.rpc("swap_pending_match_numbers", {
    p_tournament_id: T5.tournamentId,
    p_ordered_ids: [...ids],
  });

const start = (sb: SupabaseClient, id: string) =>
  sb.rpc("start_match_atomic", { p_match_id: id, p_player_ids: [] });

const rotate = <T,>(arr: readonly T[], by: number): T[] => [
  ...arr.slice(by % arr.length),
  ...arr.slice(0, by % arr.length),
];

// "final order equals caller X's list" — the RPC assigns the set's sorted
// numbers (here 1..8) to the caller's ids in order.
function matchesOrder(numById: Map<string, number>, order: readonly string[]): boolean {
  return order.every((id, i) => numById.get(id) === i + 1);
}

async function numbersById(sb: SupabaseClient): Promise<Map<string, number>> {
  const rows = await fetchT5(sb);
  return new Map(rows.map((r) => [r.id as string, r.match_number as number]));
}

function assertPermutation(nums: number[]) {
  expect([...nums].sort((a, b) => a - b)).toEqual(
    Array.from({ length: T5.matchIds.length }, (_, i) => i + 1),
  );
}

test.describe.serial("T5 race-hardening — tournament queue", () => {
  test.beforeAll(async () => {
    await seedT5(adminClient());
  });

  test.afterAll(async () => {
    await teardownT5(adminClient());
  });

  test("R5: two live tabs, mid-drag vs server reorder — both converge (I5)", async ({ browser }) => {
    test.setTimeout(180_000);
    const sb = adminClient();
    await resetT5(sb);

    const mkPage = async () => {
      const ctx = await browser.newContext({ storageState: "e2e/.auth/state.json" });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      await page.goto(T5_QUEUE_URL);
      return { ctx, page, errors };
    };

    const teamOrder = async (page: Page): Promise<string[]> => {
      const texts = await page.locator("ul > li", { hasText: "SMOKE_" }).allTextContents();
      return texts
        .map((t) => t.match(/SMOKE_[A-H]/)?.[0] ?? "?")
        .filter((t) => t !== "?");
    };
    const waitForOrder = async (page: Page, expected: string[], timeout = 8_000): Promise<boolean> => {
      try {
        await expect.poll(() => teamOrder(page), { timeout }).toEqual(expected);
        return true;
      } catch {
        return false;
      }
    };

    const p1 = await mkPage();
    const p2 = await mkPage();
    try {
      await expect.poll(() => teamOrder(p1.page), { timeout: 15_000 }).toEqual([...T5.teamNames]);
      await expect.poll(() => teamOrder(p2.page), { timeout: 15_000 }).toEqual([...T5.teamNames]);

      // warm-up gate: prove BOTH tabs' realtime→UI pipelines are live before
      // racing (sentinel reorder must reach both), then restore the baseline.
      const sentinel = rotate(T5.matchIds, 1);
      const sentinelOrder = [...T5.teamNames.slice(1), T5.teamNames[0]];
      let warmed = false;
      for (let attempt = 0; attempt < 4 && !warmed; attempt++) {
        expect((await swap(sb, sentinel)).error).toBeNull();
        const [p1Warm, p2Warm] = await Promise.all([
          waitForOrder(p1.page, sentinelOrder),
          waitForOrder(p2.page, sentinelOrder),
        ]);
        warmed = p1Warm && p2Warm;
        if (!warmed) {
          await resetT5(sb);
          await Promise.all([
            waitForOrder(p1.page, [...T5.teamNames]),
            waitForOrder(p2.page, [...T5.teamNames]),
          ]);
        }
      }
      expect(warmed, "both tabs should receive a realtime sentinel reorder before racing").toBe(true);
      await resetT5(sb);
      await expect.poll(() => teamOrder(p1.page), { timeout: 30_000 }).toEqual([...T5.teamNames]);
      await expect.poll(() => teamOrder(p2.page), { timeout: 30_000 }).toEqual([...T5.teamNames]);

      // page1: pick up row 1 and hold (suppresses realtime patches on this tab)
      const handle = p1.page.getByRole("button", { name: "ลากเพื่อจัดลำดับ" }).first();
      const hBox = (await handle.boundingBox())!;
      await p1.page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
      await p1.page.mouse.down();
      await p1.page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2 + 14, { steps: 4 });

      // server-side reorder lands while page1 is mid-drag
      const serverOrder = rotate(T5.matchIds, 2);
      const { error: swapErr } = await swap(sb, serverOrder);
      expect(swapErr).toBeNull();

      // page2 (not dragging) should re-sort from realtime (patch or refresh)
      await expect
        .poll(() => teamOrder(p2.page), { timeout: 15_000 })
        .toEqual(["SMOKE_C", "SMOKE_D", "SMOKE_E", "SMOKE_F", "SMOKE_G", "SMOKE_H", "SMOKE_A", "SMOKE_B"]);

      // page1: drop onto the third row → commits its own full-list order last
      const row3 = p1.page.locator("ul > li", { hasText: "SMOKE_" }).nth(2);
      const rBox = (await row3.boundingBox())!;
      await p1.page.mouse.move(rBox.x + rBox.width / 2, rBox.y + rBox.height / 2, { steps: 10 });
      await p1.page.mouse.up();

      // convergence: both tabs and the DB agree on one final order (I5)
      await expect
        .poll(
          async () => {
            const [o1, o2] = await Promise.all([teamOrder(p1.page), teamOrder(p2.page)]);
            return o1.length === T5.teamNames.length && JSON.stringify(o1) === JSON.stringify(o2);
          },
          { timeout: 20_000 },
        )
        .toBe(true);
      const finalOrder = await teamOrder(p1.page);
      expect(new Set(finalOrder).size).toBe(T5.teamNames.length);

      const numById = await numbersById(sb);
      assertPermutation([...numById.values()]);
      const dbOrder = [...numById.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([id]) => T5.teamNames[T5.matchIds.indexOf(id)]);
      expect(finalOrder).toEqual(dbOrder);
      console.log(`R5 converged order: ${finalOrder.join(" → ")}`);

      expect(p1.errors, `page1 console errors: ${p1.errors.join(" | ")}`).toEqual([]);
      expect(p2.errors, `page2 console errors: ${p2.errors.join(" | ")}`).toEqual([]);
    } finally {
      await p1.ctx.close();
      await p2.ctx.close();
    }
  });

  test("R1: concurrent full-list reorders serialize (I1+I2)", async () => {
    test.setTimeout(120_000);
    const sb = adminClient();
    let aWins = 0;
    let bWins = 0;

    for (let round = 0; round < ROUNDS; round++) {
      await resetT5(sb);
      const orderA = [...T5.matchIds].reverse();
      const orderB = rotate(T5.matchIds, (round % (T5.matchIds.length - 1)) + 1);

      const [ra, rb] = await Promise.all([swap(sb, orderA), swap(sb, orderB)]);
      // advisory xact lock serializes the two calls — neither should error
      expect(ra.error, `round ${round} A: ${ra.error?.message}`).toBeNull();
      expect(rb.error, `round ${round} B: ${rb.error?.message}`).toBeNull();

      const numById = await numbersById(sb);
      assertPermutation([...numById.values()]); // I1
      const winA = matchesOrder(numById, orderA);
      const winB = matchesOrder(numById, orderB);
      expect(winA || winB, `round ${round}: interleaved mix — neither caller's order`).toBe(true); // I2
      if (winA) aWins++;
      if (winB) bWins++;
    }
    console.log(`R1: last-committed winner split A=${aWins} B=${bWins} over ${ROUNDS} rounds`);
  });

  test("R2: reorder racing a concurrent start — no renumber after start returns (I6)", async () => {
    test.setTimeout(180_000);
    const sb = adminClient();
    const target = T5.matchIds[T5.matchIds.length - 1]; // last id → widest window after validation
    let midGameRenumber = 0;
    let swapRejected = 0;
    let swapWonFirst = 0;

    for (let round = 0; round < WINDOW_ROUNDS; round++) {
      await resetT5(sb);
      const order = rotate(T5.matchIds, (round % (T5.matchIds.length - 1)) + 1);

      // Snapshot the target's number the moment start returns ok. If the swap
      // committed first, start was blocked on the row lock and begins with the
      // NEW number — snapshot == final. If start committed first, the swap must
      // reject, so nothing may legally change the number after this point:
      // snapshot != final ⇒ an in_progress match was renumbered mid-game.
      const startThenSnapshot = async () => {
        const rt = await start(sb, target);
        const { data, error } = await sb
          .from("matches")
          .select("match_number")
          .eq("id", target)
          .single();
        // A failed snapshot must abort the round loudly — an undefined value
        // would be counted as a phantom mid-game renumber.
        if (error || !data) {
          throw new Error(`R2 snapshot select failed: ${error?.message ?? "no row"}`);
        }
        return { rt, numAtStartReturn: data.match_number as number };
      };

      const [rs, { rt, numAtStartReturn }] = await Promise.all([
        swap(sb, order),
        startThenSnapshot(),
      ]);
      // start must always succeed here (the match is pending at round start)
      expect(rt.error, `round ${round} start: ${rt.error?.message}`).toBeNull();
      expect((rt.data as { ok: boolean }).ok).toBe(true);

      const rows = await fetchT5(sb);
      assertPermutation(rows.map((r) => r.match_number as number)); // I1 — numbers never corrupt
      const started = rows.find((r) => r.id === target)!;
      expect(started.status).toBe("in_progress");

      if ((started.match_number as number) !== numAtStartReturn) midGameRenumber++;

      if (rs.error) {
        // start committed first → whole reorder rejected (documented behavior)
        expect(rs.error.message).toMatch(/not pending/i);
        swapRejected++;
        expect(started.match_number).toBe(T5.matchIds.length); // untouched
      } else {
        // swap won the row locks first → start blocked, began with its new
        // number, which must be exactly what the submitted order implies
        // (the RPC assigns the sorted numbers 1..N in caller order).
        swapWonFirst++;
        expect(started.match_number).toBe(order.indexOf(target) + 1);
      }
    }
    console.log(
      `R2: swapRejected=${swapRejected} swapWonFirst=${swapWonFirst} midGameRenumber=${midGameRenumber} / ${WINDOW_ROUNDS}`,
    );
    expect(midGameRenumber, "I6 — no match may be renumbered after it started").toBe(0);
  });

  test("R3: two matches, same court, started concurrently — exactly one wins (I3)", async () => {
    test.setTimeout(120_000);
    const sb = adminClient();
    const [m1, m2] = [T5.matchIds[0], T5.matchIds[1]];

    for (let round = 0; round < ROUNDS; round++) {
      await resetT5(sb);
      const { error: courtErr } = await sb
        .from("matches")
        .update({ court: T5.courts[0] })
        .in("id", [m1, m2]);
      expect(courtErr).toBeNull();

      const [r1, r2] = await Promise.all([start(sb, m1), start(sb, m2)]);
      const oks = [r1, r2].filter((r) => !r.error && (r.data as { ok: boolean }).ok === true);
      const uniqueViolations = [r1, r2].filter((r) => r.error?.code === "23505");
      expect(oks.length, `round ${round}: both starts succeeded on one court`).toBe(1);
      expect(uniqueViolations.length, `round ${round}: loser did not hit the court index`).toBe(1);

      const rows = await fetchT5(sb);
      expect(rows.filter((r) => r.status === "in_progress").length).toBe(1);
    }
  });

  test("R4: the same match started twice concurrently — one ok, one turned away (I4)", async () => {
    test.setTimeout(120_000);
    const sb = adminClient();
    const m3 = T5.matchIds[2];

    for (let round = 0; round < ROUNDS; round++) {
      await resetT5(sb);
      const [r1, r2] = await Promise.all([start(sb, m3), start(sb, m3)]);
      expect(r1.error).toBeNull();
      expect(r2.error).toBeNull();
      const results = [r1.data, r2.data] as { ok: boolean; reason?: string }[];
      expect(results.filter((r) => r.ok).length, `round ${round}`).toBe(1);
      const loser = results.find((r) => !r.ok)!;
      expect(["in_progress", "status_changed"]).toContain(loser.reason);

      const rows = await fetchT5(sb);
      expect(rows.filter((r) => r.status === "in_progress").length).toBe(1);
    }
  });
});
