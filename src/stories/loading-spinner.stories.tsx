import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

const meta = {
  title: "UI/LoadingSpinner",
  component: LoadingSpinner,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  argTypes: {
    fullscreen: {
      control: "boolean",
      description: "min-h-screen (route-level) when true, else min-h-[60vh] (in-page)",
      table: { defaultValue: { summary: "false" } },
    },
    className: {
      control: "text",
      description: "Extra utility classes merged via cn()",
    },
  },
  args: { fullscreen: false },
} satisfies Meta<typeof LoadingSpinner>;

export default meta;
type Story = StoryObj<typeof meta>;

// In-page loading state — centered in a 60vh box.
export const Default: Story = {};

// Route-level loading — occupies min-h-screen.
export const Fullscreen: Story = { args: { fullscreen: true } };

// Playground — tweak props live from the Controls panel.
export const Playground: Story = { args: { fullscreen: false, className: "" } };

// CssCheck — proves the shared preview actually loaded Tailwind + globals.css.
// The wrapper uses the `flex` utility; getComputedStyle reports display:flex
// only if the stylesheet loaded (a bare <div> would be display:block).
// This is the single project-wide CSS smoke test.
export const CssCheck: Story = {
  play: async ({ canvasElement }) => {
    const wrapper = canvasElement.querySelector("div");
    await expect(wrapper).not.toBeNull();
    await expect(getComputedStyle(wrapper!).display).toBe("flex");
  },
};
