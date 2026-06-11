"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("tournament");
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

  function removeThreshold(thr: number) {
    onChange(value.filter((v) => v !== thr));
  }

  return (
    <Field>
      <FieldLabel>{t("thresholdChipList.label")}</FieldLabel>
      <div className="flex flex-wrap items-center gap-1.5 min-h-8">
        {value.map((thr) => (
          <Badge key={thr} variant="secondary" className="gap-1 pr-1 text-sm font-mono">
            {thr}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-4 w-4 p-0 hover:bg-transparent"
              onClick={() => removeThreshold(thr)}
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
              placeholder={t("thresholdChipList.placeholder")}
            />
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs"
            onClick={() => setAddActive(true)}>
            <Plus className="h-3 w-3" /> {t("thresholdChipList.btnAdd")}
          </Button>
        )}
      </div>
      <FieldDescription>
        {t("thresholdChipList.description", { N })}
      </FieldDescription>
    </Field>
  );
}
