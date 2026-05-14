"use client";

import { useState, useTransition } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { UserPlus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { addCoAdminAction, removeCoAdminAction } from "@/lib/actions/admins";
import type { TournamentAdmin } from "@/lib/actions/admins";

export function CoAdminControls({
  tournamentId,
  initialAdmins,
}: {
  tournamentId: string;
  initialAdmins: TournamentAdmin[];
}) {
  const [admins, setAdmins] = useState<TournamentAdmin[]>(initialAdmins);
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    defaultValues: { userId: "" },
    onSubmit: async ({ value }) => {
      const res = await addCoAdminAction(tournamentId, value.userId.trim());
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("เพิ่ม co-admin แล้ว");
      setAdmins((prev) => [
        ...prev,
        {
          tournament_id: tournamentId,
          user_id: value.userId.trim(),
          added_by: "",
          added_at: new Date().toISOString(),
        },
      ]);
      form.reset();
    },
  });

  function handleRemove(userId: string) {
    startTransition(async () => {
      const res = await removeCoAdminAction(tournamentId, userId);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("ลบ co-admin แล้ว");
      setAdmins((prev) => prev.filter((a) => a.user_id !== userId));
    });
  }

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <p className="text-sm font-semibold">ผู้ช่วยดูแล (Co-admin)</p>

        {admins.length === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีผู้ช่วยดูแล</p>
        ) : (
          <ul className="space-y-1">
            {admins.map((admin) => (
              <li key={admin.user_id} className="flex items-center justify-between gap-2">
                <span className="text-sm font-mono truncate">{admin.user_id}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive shrink-0"
                  disabled={isPending}
                  onClick={() => handleRemove(admin.user_id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
          className="flex gap-2"
        >
          <form.Field
            name="userId"
            validators={{
              onChange: ({ value }) =>
                !value.trim() ? "ระบุ LINE user ID" : undefined,
            }}
          >
            {(field) => (
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder="LINE user ID"
                className="h-8 text-sm flex-1"
              />
            )}
          </form.Field>
          <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <Button
                type="submit"
                size="sm"
                disabled={!canSubmit || isSubmitting || isPending}
                className="h-8 shrink-0"
              >
                {(isSubmitting || isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
                {!(isSubmitting || isPending) && <UserPlus className="h-3.5 w-3.5" />}
                เพิ่ม
              </Button>
            )}
          </form.Subscribe>
        </form>
      </CardContent>
    </Card>
  );
}
