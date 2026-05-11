"use client";

import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { setTotalCostAction } from "@/lib/actions/clubs";

export function SetTotalCostForm({
  clubId,
  currentTotal,
}: {
  clubId: string;
  currentTotal: number | null;
}) {
  const form = useForm({
    defaultValues: {
      total_cost: currentTotal ?? 0,
    },
    onSubmit: async ({ value }) => {
      const res = await setTotalCostAction({ club_id: clubId, total_cost: value.total_cost });
      if (res?.error) toast.error(res.error);
      else toast.success("บันทึกค่าก๊วนแล้ว");
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="flex items-center gap-2"
    >
      <form.Field
        name="total_cost"
        validators={{ onChange: ({ value }) => value < 0 ? "ค่าก๊วนต้องไม่ติดลบ" : undefined }}
      >
        {(field) => (
          <Input
            type="number"
            min={0}
            step="1"
            value={field.state.value}
            onChange={(e) => field.handleChange(Number(e.target.value))}
            onBlur={field.handleBlur}
            placeholder="ค่าก๊วนรวม (บาท)"
            className="w-48"
          />
        )}
      </form.Field>

      <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
        {([canSubmit, isSubmitting]) => (
          <Button type="submit" variant="outline" size="sm" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? "บันทึก..." : "ตั้งค่าก๊วนรวม"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
