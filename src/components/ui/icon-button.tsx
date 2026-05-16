"use client";

import * as React from "react";
import { Button, type buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { VariantProps } from "class-variance-authority";

type ButtonProps = React.ComponentProps<typeof Button> &
  VariantProps<typeof buttonVariants>;

type Props = ButtonProps & {
  tooltip: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
};

/**
 * Button wrapped with a Tooltip — used for icon-only or terse-label
 * buttons that benefit from a hover hint. Forwards all Button props
 * through and uses the `tooltip` prop as the hint content.
 *
 * Falls back to `aria-label={tooltip}` when the caller didn't supply
 * an explicit aria-label, so screen readers always get the hint too.
 */
export function IconButton({
  tooltip,
  side = "top",
  "aria-label": ariaLabel,
  ...buttonProps
}: Props) {
  const ariaText = typeof tooltip === "string" ? tooltip : undefined;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={ariaLabel ?? ariaText}
            {...buttonProps}
          />
        }
      />
      <TooltipContent side={side}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
