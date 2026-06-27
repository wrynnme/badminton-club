import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BracketMatchCard } from "@/components/tournament/bracket-match-card";
import { makeMatch, competitorA, competitorB, completedGames } from "./fixtures";
import type { MatchStatus } from "@/lib/types";

// Virtual args drive the render so the Controls panel can flip match state
// without hand-editing the (large) Match object.
type BracketArgs = {
  status: MatchStatus;
  empty: boolean;
};

const meta = {
  title: "Tournament/BracketMatchCard",
  // No `component`: stories are render-driven with virtual args (status/empty),
  // which don't match the component's prop shape. Controls/docs come from argTypes.
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    status: {
      control: "radio",
      options: ["pending", "in_progress", "completed"],
      description: "Match status — 'completed' highlights the winning side",
    },
    empty: {
      control: "boolean",
      description: "Render the empty bracket slot (dashed '—' placeholder)",
    },
  },
  args: { status: "completed", empty: false },
  render: ({ status, empty }) => {
    if (empty) {
      return <BracketMatchCard match={null} competitorA={null} competitorB={null} />;
    }
    const match = makeMatch({
      status,
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
      <BracketMatchCard match={match} competitorA={competitorA} competitorB={competitorB} />
    );
  },
} satisfies Meta<BracketArgs>;

export default meta;
type Story = StoryObj<BracketArgs>;

export const Pending: Story = { args: { status: "pending" } };
export const Completed: Story = { args: { status: "completed" } };
export const Empty: Story = { args: { empty: true } };
// Playground — flip status / empty from the Controls panel.
export const Playground: Story = {};
