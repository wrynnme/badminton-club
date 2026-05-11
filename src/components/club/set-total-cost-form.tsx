"use client";

import * as React from "react";
import * as z from "zod";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { setTotalCostAction } from "@/lib/actions/clubs";

const formSchema = z.object({
  total_cost: z.number().min(0, "ค่าก๊วนต้องไม่ติดลบ"),
});

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
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const res = await setTotalCostAction({ club_id: clubId, total_cost: value.total_cost });
      if (res?.error) toast.error(res.error);
      else toast.success("บันทึกค่าก๊วนแล้ว");
    },
  });

  return (
    <form
      id="set-total-cost-form"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field
          name="total_cost"
          children={(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>ค่าก๊วนรวม</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id={field.name}
                    name={field.name}
                    type="number"
                    min={0}
                    step="1"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(Number(e.target.value))}
                    aria-invalid={isInvalid}
                    placeholder="0"
                    className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>บาท</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                {isInvalid && (
                  <FieldError errors={field.state.meta.errors.map((e) => ({ message: String(e) }))} />
                )}
              </Field>
            );
          }}
        />
      </FieldGroup>

      <Field orientation="horizontal" className="mt-3">
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" variant="outline" size="sm" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "บันทึก..." : "ตั้งค่าก๊วนรวม"}
            </Button>
          )}
        </form.Subscribe>
      </Field>
    </form>
  );
}
