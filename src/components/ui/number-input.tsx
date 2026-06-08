"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

type NumberInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type"
> & {
  /** Current numeric value (controlled). */
  value: number;
  /** Called with the parsed, clamped number on every edit. */
  onValueChange: (value: number) => void;
  /** Lower clamp bound (default 0). */
  min?: number;
  /** Upper clamp bound. */
  max?: number;
  /** Value reported when the field is left empty (default 0). */
  emptyValue?: number;
};

/**
 * A controlled number input that may be visually EMPTY while editing — an empty
 * field reports `emptyValue` (default 0) instead of being forced back to "0".
 *
 * The fix: keep a local string mirror of the text so clearing the field doesn't
 * snap back to the numeric value. The parsed number is clamped to [min, max] and
 * pushed up via `onValueChange`.
 */
export function NumberInput({
  value,
  onValueChange,
  min = 0,
  max,
  emptyValue = 0,
  ...props
}: NumberInputProps) {
  const [text, setText] = useState(() => String(value));

  // Resync the mirror when the controlled value changes externally (e.g. a form
  // reset), but never clobber an in-progress edit whose number already matches.
  useEffect(() => {
    const parsed = text.trim() === "" ? emptyValue : Number(text);
    if (parsed !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function clamp(n: number): number {
    let v = n;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    return v;
  }

  return (
    <Input
      {...props}
      type="number"
      inputMode={props.inputMode ?? "decimal"}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = t.trim() === "" ? emptyValue : Number(t);
        if (!Number.isNaN(n)) onValueChange(clamp(n));
      }}
    />
  );
}
