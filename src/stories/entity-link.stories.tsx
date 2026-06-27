import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { EntityLink } from "@/components/tournament/stats/entity-link";

// Router context for the "linked" stories — pretend we're inside /tournaments/[id].
const insideTournament = {
  nextjs: {
    appDirectory: true,
    navigation: {
      pathname: "/tournaments/abc",
      segments: [["id", "abc"]] as [string, string][],
    },
  },
};

const meta = {
  title: "Tournament/EntityLink",
  component: EntityLink,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    entityType: {
      control: "select",
      options: ["pair", "team", "player", "division"],
      description: "Which per-entity stats page to link to",
    },
    entityId: {
      control: "text",
      description: "Entity UUID — falsy value renders children unwrapped (no link)",
    },
    children: { control: "text", description: "Link label" },
    className: { control: "text" },
  },
  args: {
    entityType: "pair",
    entityId: "pair-a",
    children: "สมชาย / สมหญิง",
  },
} satisfies Meta<typeof EntityLink>;

export default meta;
type Story = StoryObj<typeof meta>;

// Outside any tournament route → pathname guard fails → children render plain.
export const Unwrapped: Story = {};

// Inside /tournaments/[id] → renders an underlined stats link.
export const AsLink: Story = {
  parameters: insideTournament,
  // Proves the router-derived href resolves: pathname + params.id + entityType/id.
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link")).toHaveAttribute(
      "href",
      "/tournaments/abc/stats/pair/pair-a",
    );
  },
};

// Playground — change entityType / entityId / label from the Controls panel
// (rendered inside a tournament route so the link resolves).
export const Playground: Story = { parameters: insideTournament };
