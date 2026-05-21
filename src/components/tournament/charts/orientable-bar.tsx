"use client";

import { XAxis, YAxis } from "recharts";

export type Orientation = "vertical" | "horizontal";

/**
 * Helpers for switching a recharts BarChart between vertical (categories on
 * X, values on Y) and horizontal (categories on Y, values on X) orientations
 * without duplicating per-chart axis JSX.
 *
 * Recharts itself uses `layout="vertical"` for horizontally-oriented charts.
 * We use the user-facing term "horizontal" to mean "bars run left-to-right"
 * and map it onto recharts' awkward naming inside this module.
 */

/**
 * Returns the axis-type pair + label position for a given orientation.
 *   horizontal → bars run left-to-right; categories on Y, values on X,
 *                labels sit to the right of each bar.
 *   vertical   → bars stand up; categories on X, values on Y, labels sit on top.
 */
export function orientableBarLayout(orientation: Orientation): {
  /** recharts layout prop — only set when horizontal. */
  layout?: "vertical";
  xAxisType: "number" | "category";
  yAxisType: "number" | "category";
  labelPosition: "top" | "right";
} {
  const horizontal = orientation === "horizontal";
  return {
    layout: horizontal ? "vertical" : undefined,
    xAxisType: horizontal ? "number" : "category",
    yAxisType: horizontal ? "category" : "number",
    labelPosition: horizontal ? "right" : "top",
  };
}

/**
 * Renders the appropriate `<XAxis>` + `<YAxis>` pair for an orientable bar
 * chart. The value-axis is hidden by default (set `valueAxisHidden={false}`
 * to show it — used by the W/D/L chart). The category-axis always shows its
 * ticks.
 *
 * `categoryYWidth` only applies when horizontal (the YAxis carries the
 * category labels and needs space for them). Defaults to 92.
 */
export function OrientableBarAxes({
  orientation,
  dataKey,
  categoryYWidth = 92,
  tickFontSize = 12,
  tickFontWeight,
  valueAxisHidden = true,
  valueAxisAllowDecimals,
}: {
  orientation: Orientation;
  /** Field name in the data array that holds the category label. */
  dataKey: string;
  /** Width reserved for the YAxis ticks in horizontal mode. */
  categoryYWidth?: number;
  tickFontSize?: number;
  /** Optional fontWeight forwarded to the category tick `tick` prop. */
  tickFontWeight?: number;
  /** When true (default), the value-axis is `hide`d. When false, it renders ticks. */
  valueAxisHidden?: boolean;
  /** Forwarded to the value axis (typically `false` for integer counts). */
  valueAxisAllowDecimals?: boolean;
}) {
  const categoryTick =
    tickFontWeight !== undefined
      ? { fontSize: tickFontSize, fontWeight: tickFontWeight }
      : { fontSize: tickFontSize };
  if (orientation === "horizontal") {
    return (
      <>
        <XAxis
          type="number"
          {...(valueAxisHidden
            ? { hide: true }
            : {
                tickLine: false,
                axisLine: false,
                tickMargin: 4,
                tick: { fontSize: tickFontSize },
              })}
          {...(valueAxisAllowDecimals !== undefined
            ? { allowDecimals: valueAxisAllowDecimals }
            : {})}
        />
        <YAxis
          type="category"
          dataKey={dataKey}
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          width={categoryYWidth}
          tick={categoryTick}
        />
      </>
    );
  }
  return (
    <>
      <XAxis
        type="category"
        dataKey={dataKey}
        tickLine={false}
        axisLine={false}
        tickMargin={6}
        tick={categoryTick}
      />
      <YAxis
        type="number"
        {...(valueAxisHidden
          ? { hide: true }
          : {
              tickLine: false,
              axisLine: false,
              tickMargin: 4,
              tick: { fontSize: tickFontSize },
            })}
        {...(valueAxisAllowDecimals !== undefined
          ? { allowDecimals: valueAxisAllowDecimals }
          : {})}
      />
    </>
  );
}
