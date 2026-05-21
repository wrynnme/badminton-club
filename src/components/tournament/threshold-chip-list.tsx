"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function ThresholdChipList({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const [addRaw, setAddRaw] = useState("");
  const [addActive, setAddActive] = useState(false);
  const N = value.length + 1;

  function addThreshold() {
    const n = parseFloat(addRaw);
    if (!Number.isFinite(n)) { setAddRaw(""); setAddActive(false); return; }
    const next = [...new Set([...value, n])].sort((a, b) => a - b);
    onChange(next);
    setAddRaw("");
    setAddActive(false);
  }

  function removeThreshold(t: number) {
    onChange(value.filter((v) => v !== t));
  }

  return (
    <Field>
      <FieldLabel>Thresholds แบ่ง Division</FieldLabel>
      <div className="flex flex-wrap items-center gap-1.5 min-h-8">
        {value.map((t) => (
          <Badge key={t} variant="secondary" className="gap-1 pr-1 text-sm font-mono">
            {t}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-4 w-4 p-0 hover:bg-transparent"
              onClick={() => removeThreshold(t)}
            >
              <X className="h-3 w-3" />
            </Button>
          </Badge>
        ))}
        {addActive ? (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              step="0.5"
              autoFocus
              value={addRaw}
              onChange={(e) => setAddRaw(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addThreshold(); } if (e.key === "Escape") { setAddRaw(""); setAddActive(false); } }}
              onBlur={addThreshold}
              className="h-7 w-24 text-sm"
              placeholder="เช่น 5"
            />
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs"
            onClick={() => setAddActive(true)}>
            <Plus className="h-3 w-3" /> เพิ่ม threshold
          </Button>
        )}
      </div>
      <FieldDescription>
        → จะแบ่งเป็น {N} Division · threshold เรียงน้อย→มาก เช่น 3,5,7 → 4 Div · pair_level &gt; สูงสุด = D1
      </FieldDescription>
    </Field>
  );
}
