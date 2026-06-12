"use client";

import { fieldErrors } from "@/lib/form-errors";
import { useTranslations } from "next-intl";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { updateProfileDisplayNameAction } from "@/lib/actions/profile";
import { makeDisplayNameSchema } from "@/lib/validation/profile";

export function EditProfileForm({ displayName }: { displayName: string }) {
  const t = useTranslations("settings");
  const tv = useTranslations("validation");
  const router = useRouter();
  const displayNameSchema = makeDisplayNameSchema({
    required: tv("required.name"),
    tooLong: tv("name.tooLong"),
  });
  const form = useForm({
    defaultValues: { display_name: displayName },
    validators: { onSubmit: displayNameSchema },
    onSubmit: async ({ value }) => {
      const res = await updateProfileDisplayNameAction(value);
      if (res?.error) {
        toast.error(res.error);
      } else {
        toast.success(t("editName.success"));
        router.refresh();
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field
          name="display_name"
          children={(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>{t("editName.label")}</FieldLabel>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  maxLength={40}
                  aria-invalid={isInvalid}
                />
                {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
              </Field>
            );
          }}
        />
      </FieldGroup>

      <Field orientation="horizontal" className="mt-4">
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button type="submit" disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? t("editName.saving") : t("editName.save")}
                  </Button>
                }
              />
              <TooltipContent>{t("editName.saveTooltip")}</TooltipContent>
            </Tooltip>
          )}
        </form.Subscribe>
      </Field>
    </form>
  );
}
