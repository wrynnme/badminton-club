import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { TvMatchCard } from "@/components/tournament/tv-match-card";
import {
  makeMatch,
  competitorA,
  competitorB,
  pairCompetitorMap,
  completedGames,
} from "./fixtures";
import type { MatchStatus } from "@/lib/types";

// Virtual args (status) + real pass-through props (unit, fillHeight) so the
// Controls panel can drive the card through every state.
type TvArgs = {
  status: MatchStatus;
  unit: "team" | "pair";
  fillHeight: boolean;
};

const meta = {
  title: "Tournament/TvMatchCard",
  // No `component`: render-driven with virtual args (status). Controls from argTypes.
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    status: {
      control: "radio",
      options: ["pending", "in_progress", "completed"],
      description: "pending → 'VS', in_progress → glow + live dot, completed → winner highlight",
    },
    unit: { control: "radio", options: ["team", "pair"] },
    fillHeight: {
      control: "boolean",
      description: "Stretch to fill parent height (grid cells on the TV page)",
    },
  },
  args: { status: "in_progress", unit: "pair", fillHeight: false },
  render: ({ status, unit, fillHeight }) => {
    const match = makeMatch({
      status,
      // Both id pairs set so the single fixture map resolves for unit=team|pair.
      team_a_id: competitorA.id,
      team_b_id: competitorB.id,
      pair_a_id: competitorA.id,
      pair_b_id: competitorB.id,
      court: "1",
      ...(status === "completed"
        ? {
            team_a_score: 2,
            team_b_score: 1,
            games: completedGames,
            winner_id: competitorA.id,
          }
        : status === "in_progress"
          ? { team_a_score: 1, team_b_score: 0, games: [{ a: 21, b: 18 }] }
          : {}),
    });
    return (
      <TvMatchCard
        match={match}
        competitorById={pairCompetitorMap}
        unit={unit}
        fillHeight={fillHeight}
      />
    );
  },
} satisfies Meta<TvArgs>;

export default meta;
type Story = StoryObj<TvArgs>;

export const Live: Story = {
  args: { status: "in_progress" },
  // "กำลังแข่ง" appearing proves the NextIntl decorator loaded the tournament
  // catalog (t("matchStatus.in_progress")) — not just that the card rendered.
  play: async ({ canvas }) => {
    await expect(canvas.getByText("กำลังแข่ง")).toBeVisible();
  },
};
export const Completed: Story = { args: { status: "completed" } };
export const Pending: Story = { args: { status: "pending" } };
// Playground — drive status / unit / fillHeight from the Controls panel.
export const Playground: Story = {};
