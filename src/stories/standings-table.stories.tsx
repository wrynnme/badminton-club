import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  StandingsTableView,
  type StandingsTableLabels,
} from "@/components/tournament/standings-table";
import { makeMatch, competitorA, competitorB, completedGames } from "./fixtures";

// Labels normally come from getTranslations("tournament") in the async wrapper;
// the presentational view takes them as props, so stories supply them directly.
const labels: StandingsTableLabels = {
  unitTeam: "ทีม",
  unitPair: "คู่",
  pointsTooltip: "ชนะ = 3 · เสมอ = 1 · แพ้ = 0",
  viewMatchesAria: "ดูแมตช์",
};

// Virtual args build the matches/competitors so the Controls panel can toggle
// unit (team/pair → the extra "view matches" column) and whether a game was played.
type StandingsArgs = {
  unit: "team" | "pair";
  played: boolean;
};

const meta = {
  title: "Tournament/StandingsTable",
  // No `component`: render-driven with virtual args (unit/played). Controls from argTypes.
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    unit: {
      control: "radio",
      options: ["team", "pair"],
      description: "Pair adds the per-pair 'view matches' column",
    },
    played: {
      control: "boolean",
      description: "One completed match (A beats B 2–1) vs no matches yet",
    },
  },
  args: { unit: "pair", played: true },
  render: ({ unit, played }) => {
    const ids =
      unit === "team"
        ? { team_a_id: competitorA.id, team_b_id: competitorB.id }
        : { pair_a_id: competitorA.id, pair_b_id: competitorB.id };
    const matches = played
      ? [
          makeMatch({
            status: "completed",
            ...ids,
            team_a_score: 2,
            team_b_score: 1,
            games: completedGames,
            winner_id: competitorA.id,
          }),
        ]
      : [];
    return (
      <StandingsTableView
        matches={matches}
        competitors={[competitorA, competitorB]}
        unit={unit}
        labels={labels}
      />
    );
  },
} satisfies Meta<StandingsArgs>;

export default meta;
type Story = StoryObj<StandingsArgs>;

// Pair table — A leads (trophy, 3 pts); includes the "view matches" column.
export const Pair: Story = { args: { unit: "pair" } };

// Team table — same result, no "view matches" column.
export const Team: Story = { args: { unit: "team" } };

// No matches played yet — both rows at zero.
export const Empty: Story = { args: { played: false } };

// Playground — toggle unit / played from the Controls panel.
export const Playground: Story = {};
