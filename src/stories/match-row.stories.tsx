import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MatchRow } from "@/components/tournament/match-row";
import {
  makeMatch,
  competitorA,
  competitorB,
  pairCompetitorMap,
  completedGames,
} from "./fixtures";
import type { MatchStatus } from "@/lib/types";

// Virtual args drive the render. isOwner=true mounts the reset / enter-score
// buttons; the server action they call is aliased to a no-op stub in Storybook
// (.storybook/mocks/actions-matches.ts), so it's safe to flip on here.
type MatchRowArgs = {
  status: MatchStatus;
  unit: "team" | "pair";
  size: "compact" | "comfortable";
  isOwner: boolean;
};

const meta = {
  title: "Tournament/MatchRow",
  // No `component`: render-driven with virtual args (status). Controls from argTypes.
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    status: { control: "radio", options: ["pending", "in_progress", "completed"] },
    unit: { control: "radio", options: ["team", "pair"] },
    size: { control: "radio", options: ["compact", "comfortable"] },
    isOwner: {
      control: "boolean",
      description: "Owner sees reset / enter-score buttons (server action mocked in Storybook)",
    },
  },
  args: { status: "completed", unit: "pair", size: "compact", isOwner: false },
  render: ({ status, unit, size, isOwner }) => {
    const match = makeMatch({
      status,
      team_a_id: competitorA.id,
      team_b_id: competitorB.id,
      pair_a_id: competitorA.id,
      pair_b_id: competitorB.id,
      ...(status === "completed"
        ? {
            team_a_score: 2,
            team_b_score: 1,
            games: completedGames,
            winner_id: competitorA.id,
          }
        : {}),
    });
    return (
      <MatchRow
        match={match}
        competitorById={pairCompetitorMap}
        tournamentId="tournament-1"
        isOwner={isOwner}
        unit={unit}
        size={size}
      />
    );
  },
} satisfies Meta<MatchRowArgs>;

export default meta;
type Story = StoryObj<MatchRowArgs>;

export const Pending: Story = { args: { status: "pending" } };
export const Completed: Story = { args: { status: "completed" } };
export const Comfortable: Story = { args: { status: "completed", size: "comfortable" } };
// Owner view — reset button visible (mocked action).
export const OwnerControls: Story = { args: { status: "completed", isOwner: true } };
// Playground — drive status / unit / size / isOwner from the Controls panel.
export const Playground: Story = {};
