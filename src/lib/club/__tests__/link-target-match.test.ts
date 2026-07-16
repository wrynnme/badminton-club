import { describe, it, expect } from "vitest";
import {
  classifyLinkTarget,
  type MemberCandidate,
  type RosterLinkCandidate,
} from "../link-target-match";

const member = (
  id: string,
  name: string,
  profileId: string | null = null,
): MemberCandidate => ({ id, canonical_name: name, profile_id: profileId });

const row = (
  id: string,
  name: string,
  opts: { profileId?: string | null; memberId?: string | null } = {},
): RosterLinkCandidate => ({
  id,
  display_name: name,
  profile_id: opts.profileId ?? null,
  member_id: opts.memberId ?? null,
});

describe("classifyLinkTarget", () => {
  it("matches a name-only member with no roster at all (sessionless series)", () => {
    expect(classifyLinkTarget([member("m1", "โจ้")], [], "โจ้")).toEqual({
      kind: "member",
      memberId: "m1",
      rosterPlayerId: null,
    });
  });

  it("matches a roster-only guest (person not in the registry yet)", () => {
    expect(classifyLinkTarget([], [row("p1", "บี")], "บี")).toEqual({
      kind: "roster",
      playerId: "p1",
    });
  });

  it("dedupes a member and their seeded roster row into ONE candidate", () => {
    const result = classifyLinkTarget(
      [member("m1", "โจ้")],
      [row("p1", "โจ้", { memberId: "m1" })],
      "โจ้",
    );
    expect(result).toEqual({ kind: "member", memberId: "m1", rosterPlayerId: "p1" });
  });

  it("still resolves the member when only the seeded roster row's name matches (member renamed)", () => {
    const result = classifyLinkTarget(
      [member("m1", "โจ้ใหม่")],
      [row("p1", "โจ้", { memberId: "m1" })],
      "โจ้",
    );
    expect(result).toEqual({ kind: "member", memberId: "m1", rosterPlayerId: "p1" });
  });

  it("does not attach a roster row that is already linked", () => {
    const result = classifyLinkTarget(
      [member("m1", "โจ้")],
      [row("p1", "โจ้", { memberId: "m1", profileId: "prof-X" })],
      "โจ้",
    );
    expect(result).toEqual({ kind: "member", memberId: "m1", rosterPlayerId: null });
  });

  it("reports ambiguous when a member and an UNRELATED roster guest share the name", () => {
    expect(
      classifyLinkTarget([member("m1", "ต่าย")], [row("p1", "ต่าย")], "ต่าย"),
    ).toEqual({ kind: "ambiguous" });
  });

  it("reports ambiguous for two members sharing the name", () => {
    expect(
      classifyLinkTarget([member("m1", "ต่าย"), member("m2", "ต่าย")], [], "ต่าย"),
    ).toEqual({ kind: "ambiguous" });
  });

  it("reports taken when the single matching member is already linked", () => {
    expect(classifyLinkTarget([member("m1", "เอ", "prof-A")], [], "เอ")).toEqual({
      kind: "taken",
    });
  });

  it("reports taken when the single matching roster row is already linked", () => {
    expect(classifyLinkTarget([], [row("p1", "เอ", { profileId: "prof-A" })], "เอ")).toEqual({
      kind: "taken",
    });
  });

  it("reports not_found for a name absent from both surfaces", () => {
    expect(classifyLinkTarget([member("m1", "โจ้")], [row("p1", "บี")], "ไม่มีจริง")).toEqual({
      kind: "not_found",
    });
  });

  it("treats an empty typed name as not_found", () => {
    expect(classifyLinkTarget([member("m1", "โจ้")], [], "   ")).toEqual({ kind: "not_found" });
  });

  it("matches case-insensitively and ignores extra whitespace", () => {
    expect(classifyLinkTarget([member("m1", "Bank")], [], "  bank  ")).toEqual({
      kind: "member",
      memberId: "m1",
      rosterPlayerId: null,
    });
  });

  it("resolves the seeded roster row by member_id even when it was renamed", () => {
    // Member keeps the typed name, but this session's seeded row was renamed —
    // the row must still be attached (found via member_id, not its name).
    expect(
      classifyLinkTarget([member("m1", "โจ้")], [row("p1", "โจ้ตัวจริง", { memberId: "m1" })], "โจ้"),
    ).toEqual({ kind: "member", memberId: "m1", rosterPlayerId: "p1" });
  });

  it("does not attach a renamed seeded row that is already linked", () => {
    expect(
      classifyLinkTarget(
        [member("m1", "โจ้")],
        [row("p1", "โจ้ตัวจริง", { memberId: "m1", profileId: "prof-X" })],
        "โจ้",
      ),
    ).toEqual({ kind: "member", memberId: "m1", rosterPlayerId: null });
  });
});
