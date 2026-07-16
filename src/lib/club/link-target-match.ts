/**
 * link-target-match.ts — PURE union classifier for series-first linking
 * (grilled 2026-07-16: "ทะเบียนเป็นหลัก + โพยเสริม").
 *
 * A typed name (keyword self-link) is matched against BOTH identity surfaces:
 *   - the series' member registry (`series_members`) — the primary target;
 *     works even when the series has no รอบตี at all, and
 *   - the active session's roster (`club_players`) — supplementary, so a guest
 *     added only inside the current รอบตี (not yet a member) still self-links.
 *
 * The two surfaces can describe the SAME person twice: a roster row seeded from
 * a member carries `member_id`. Such a pair counts as ONE candidate (member
 * precedence) — matching it yields `kind: "member"` with the roster row id
 * attached so the caller can link both in one pass. Rows/members already linked
 * (`profile_id` set) are "taken", not silently relinked. Two DIFFERENT people
 * sharing the typed name is "ambiguous" — the pool absorbs it, same as before.
 */

import { normalizeRosterName } from "@/lib/club/line-self-link";

export type MemberCandidate = {
  id: string;
  canonical_name: string;
  profile_id: string | null;
};

export type RosterLinkCandidate = {
  id: string;
  display_name: string;
  profile_id: string | null;
  member_id: string | null;
};

export type LinkTargetMatch =
  | {
      kind: "member";
      memberId: string;
      /** The active session's still-guest roster row for this member (link it too), if any. */
      rosterPlayerId: string | null;
    }
  | { kind: "roster"; playerId: string } // roster-only guest (no member behind it)
  | { kind: "taken" } // the single match is already linked
  | { kind: "ambiguous" }
  | { kind: "not_found" };

/** One deduped person: a member and/or their roster row in the active session. */
type CandidateUnit = {
  member: MemberCandidate | null;
  rosterRow: RosterLinkCandidate | null;
};

export function classifyLinkTarget(
  members: MemberCandidate[],
  roster: RosterLinkCandidate[],
  typedName: string,
): LinkTargetMatch {
  const target = normalizeRosterName(typedName);
  if (!target) return { kind: "not_found" };

  const memberById = new Map(members.map((m) => [m.id, m]));
  const memberHits = members.filter((m) => normalizeRosterName(m.canonical_name) === target);
  const rosterHits = roster.filter((r) => normalizeRosterName(r.display_name) === target);

  // Dedupe into per-person units keyed by member id where one exists — a roster
  // row seeded from a member (member_id set) belongs to that member's unit even
  // when only ONE side's name matched (e.g. the member was renamed but the
  // seeded roster row still carries the typed name: the person IS that member).
  const units = new Map<string, CandidateUnit>();
  for (const m of memberHits) {
    units.set(`member:${m.id}`, { member: m, rosterRow: null });
  }
  for (const r of rosterHits) {
    const backing = r.member_id ? memberById.get(r.member_id) : undefined;
    const key = backing ? `member:${backing.id}` : `roster:${r.id}`;
    const unit = units.get(key) ?? { member: backing ?? null, rosterRow: null };
    unit.rosterRow = r;
    units.set(key, unit);
  }

  if (units.size === 0) return { kind: "not_found" };
  if (units.size > 1) return { kind: "ambiguous" };

  const [unit] = units.values();
  if (unit.member) {
    if (unit.member.profile_id !== null) return { kind: "taken" };
    return {
      kind: "member",
      memberId: unit.member.id,
      // Attach the roster row only while it is still a guest — a row somehow
      // linked to another profile must not be overwritten.
      rosterPlayerId: unit.rosterRow && unit.rosterRow.profile_id === null ? unit.rosterRow.id : null,
    };
  }

  const row = unit.rosterRow!;
  if (row.profile_id !== null) return { kind: "taken" };
  return { kind: "roster", playerId: row.id };
}
