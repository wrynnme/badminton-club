// Shared constants for the net-zero E2E suite. All rows carry the SMOKE_E2E_
// marker and fixed UUIDs so global-setup/teardown can seed + clean deterministically.
export const E2E = {
  marker: "SMOKE_E2E_",
  ownerId: "00000000-0000-4000-8000-0000000e2e00",
  clubId: "00000000-0000-4000-8000-0000000e2c10",
  ownerName: "SMOKE_E2E_owner",
  clubName: "SMOKE_E2E_club",
  players: ["SMOKE_E2E_p1", "SMOKE_E2E_p2", "SMOKE_E2E_p3", "SMOKE_E2E_p4"],
  courts: ["1", "2"],
  gameTimeLimitMin: 1,
} as const;

export const QUEUE_URL = `/clubs/${E2E.clubId}?tab=queue`;
export const CLUB_URL = `/clubs/${E2E.clubId}`;
