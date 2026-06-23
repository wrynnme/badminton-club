import { describe, it, expect } from "vitest";
import { toPublicClub, toPublicPlayer } from "@/lib/club/public-view";
import type { Club, ClubPlayer } from "@/lib/types";

const baseClub: Club = {
  id: "club-1",
  owner_id: "owner-1",
  name: "ก๊วนทดสอบ",
  venue: "สนาม A",
  play_date: "2026-06-10",
  start_time: "19:00:00",
  end_time: "21:00:00",
  max_players: 12,
  total_cost: 1000,
  shuttle_info: "ลูกละ 25 บาท",
  notes: "งบลับ",
  created_at: "2026-06-10T00:00:00Z",
  court_fee: 500,
  court_split: "even",
  shuttle_split: "even",
  shuttle_price: 25,
  shuttle_hourly: [3, 3],
  court_gap_policy: "spread",
  queue_settings: { players_per_team: 2, court_count: 3 },
  courts: ["1", "2", "3"],
  is_public: true,
  promptpay_id: "0812345678",
  promptpay_name: "เจ้าของก๊วน",
  promptpay_qr_image: "https://example.com/qr.png",
  billing_verify_settings: { mode: "manual" },
};

const basePlayer: ClubPlayer = {
  id: "p-1",
  club_id: "club-1",
  profile_id: "profile-9",
  display_name: "ผู้เล่น A",
  level_id: "lvl-1",
  note: "ส่วนลดลับ",
  joined_at: "2026-06-10T00:00:00Z",
  position: 1,
  status: "active",
  checked_in_at: "2026-06-10T12:00:00Z",
  start_time: "19:00:00",
  end_time: "21:00:00",
  games_played: 4,
  last_finished_at: "2026-06-10T13:00:00Z",
  discount: 50,
  paid_at: "2026-06-10T14:00:00Z",
  bill_amount: 330,
  paid_method: "manual",
  bill_pushed_at: "2026-06-10T10:00:00Z",
};

describe("toPublicClub", () => {
  it("zeroes/nulls every money + free-text field", () => {
    const pub = toPublicClub(baseClub);
    expect(pub.court_fee).toBe(0);
    expect(pub.shuttle_price).toBe(0);
    expect(pub.shuttle_hourly).toEqual([]);
    expect(pub.total_cost).toBe(0);
    expect(pub.notes).toBeNull();
    expect(pub.shuttle_info).toBeNull();
    expect(pub.promptpay_id).toBeNull();
    expect(pub.promptpay_name).toBeNull();
    expect(pub.promptpay_qr_image).toBeNull();
  });

  it("keeps safe identity + config fields", () => {
    const pub = toPublicClub(baseClub);
    expect(pub.name).toBe("ก๊วนทดสอบ");
    expect(pub.venue).toBe("สนาม A");
    expect(pub.is_public).toBe(true);
    expect(pub.courts).toEqual(["1", "2", "3"]);
    expect(pub.court_split).toBe("even");
  });

  it("strips unknown/future jsonb keys from queue_settings (re-derived via parseQueueSettings)", () => {
    const pub = toPublicClub({
      ...baseClub,
      queue_settings: { players_per_team: 2, secret_price: 999, owner_note: "leak" },
    });
    expect(pub.queue_settings).not.toHaveProperty("secret_price");
    expect(pub.queue_settings).not.toHaveProperty("owner_note");
    expect(pub.queue_settings.players_per_team).toBe(2);
  });
});

describe("toPublicPlayer", () => {
  it("nulls profile_id + note and zeroes discount", () => {
    const pub = toPublicPlayer(basePlayer);
    expect(pub.profile_id).toBeNull();
    expect(pub.note).toBeNull();
    expect(pub.discount).toBe(0);
    expect(pub.paid_at).toBeNull();
  });

  it("keeps name + usage fields the public roster renders", () => {
    const pub = toPublicPlayer(basePlayer);
    expect(pub.display_name).toBe("ผู้เล่น A");
    expect(pub.games_played).toBe(4);
    expect(pub.status).toBe("active");
    expect(pub.level_id).toBe("lvl-1");
  });
});
