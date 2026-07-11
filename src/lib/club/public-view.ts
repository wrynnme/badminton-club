// Sanitizers for the anonymous public club view (/c/[id]). Single source of the
// "what is safe to expose" contract so any future public surface (embed, /c/[id]/tv,
// API) reuses the exact same redaction instead of re-deriving it.

import type { Club, ClubPlayer } from "@/lib/types";
import { parseQueueSettings } from "@/lib/club/queue-settings";

/**
 * Build the Club exposed to anonymous viewers. This is an ALLOWLIST: every field
 * is listed explicitly — safe fields copied from the row, sensitive ones zeroed/
 * nulled — so a NEW column on `Club` becomes a TS compile error here, forcing an
 * explicit safe-vs-sensitive decision instead of leaking by default through the
 * RSC props. Sensitive: fees, total_cost, free-text notes / shuttle_info (often
 * hold prices). `queue_settings` is re-derived via parseQueueSettings so only the
 * known config keys survive — any future/unknown jsonb key (which could carry a
 * price or note) is dropped rather than passed through verbatim.
 */
export function toPublicClub(club: Club): Club {
  return {
    id: club.id,
    owner_id: club.owner_id,
    name: club.name,
    venue: club.venue,
    play_date: club.play_date,
    start_time: club.start_time,
    end_time: club.end_time,
    max_players: club.max_players,
    created_at: club.created_at,
    court_split: club.court_split,
    shuttle_split: club.shuttle_split,
    court_gap_policy: club.court_gap_policy,
    queue_settings: parseQueueSettings(club.queue_settings),
    courts: club.courts,
    is_public: club.is_public,
    // sensitive — money / free-text (may carry prices)
    court_fee: 0,
    shuttle_price: 0,
    shuttle_hourly: [],
    shuttle_total: 0,
    total_cost: 0,
    notes: null,
    shuttle_info: null,
    // payment receiver details — never expose on the anonymous public view
    promptpay_id: null,
    promptpay_name: null,
    promptpay_qr_image: null,
    // receipt customization — redact: receipt_template can carry bank-account details
    // (name / account no), and the slip is a manager-only surface anyway
    receipt_template: {},
    receipt_logo_url: null,
    // LINE-linking join token — a secret share token; never expose publicly.
    join_token: null,
  };
}

/**
 * Per-player sanitized view for the public page. Same allowlist fail-safe as
 * toPublicClub. Sensitive: profile_id (account link), note (free text), discount
 * (money). Player names render publicly (they are the point of the roster).
 */
export function toPublicPlayer(p: ClubPlayer): ClubPlayer {
  return {
    id: p.id,
    club_id: p.club_id,
    display_name: p.display_name,
    level_id: p.level_id,
    joined_at: p.joined_at,
    position: p.position,
    status: p.status,
    checked_in_at: p.checked_in_at,
    start_time: p.start_time,
    end_time: p.end_time,
    games_played: p.games_played,
    last_finished_at: p.last_finished_at,
    // sensitive
    profile_id: null,
    note: null,
    discount: 0,
    paid_at: null,       // payment status is manager-only money data
    bill_amount: null,   // billing metadata — manager-only
    paid_method: null,
    bill_pushed_at: null,
  };
}
