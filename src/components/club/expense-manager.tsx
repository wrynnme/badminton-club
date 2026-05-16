"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import * as z from "zod";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addExpenseAction, updateExpenseAction, deleteExpenseAction } from "@/lib/actions/clubs";
import type { ClubExpense } from "@/lib/actions/clubs";

const expenseSchema = z.object({
  label: z.string().min(1, "ระบุชื่อรายการ"),
  amount: z.number().min(0, "จำนวนเงินไม่ถูกต้อง"),
});

// ─── Shared form ──────────────────────────────────────────────────────────────

function ExpenseForm({
  defaultValues,
  onSubmit,
  onCancel,
}: {
  defaultValues: { label: string; amount: number };
  onSubmit: (value: { label: string; amount: number }) => Promise<void>;
  onCancel: () => void;
}) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: expenseSchema },
    onSubmit: async ({ value }) => { await onSubmit(value); },
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}
      className="flex items-center gap-2"
    >
      <form.Field name="label">
        {(field) => (
          <Input
            placeholder="ชื่อรายการ เช่น ค่าสนาม"
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
            className="flex-1 h-8 text-sm"
            aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
          />
        )}
      </form.Field>

      <form.Field name="amount">
        {(field) => (
          <div className="relative w-28 shrink-0">
            <Input
              type="number"
              min={0}
              step={1}
              placeholder="0"
              value={field.state.value}
              onChange={(e) => field.handleChange(Number(e.target.value))}
              onBlur={field.handleBlur}
              className="h-8 text-sm pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              ฿
            </span>
          </div>
        )}
      </form.Field>

      <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
        {([canSubmit, isSubmitting]) => (
          <>
            <Button type="submit" size="icon-sm" variant="ghost" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : <Check className="text-green-600" />}
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" onClick={onCancel}>
              <X className="text-muted-foreground" />
            </Button>
          </>
        )}
      </form.Subscribe>
    </form>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ExpenseManager({
  clubId,
  expenses,
  playerCount,
}: {
  clubId: string;
  expenses: ClubExpense[];
  playerCount: number;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startDelete] = useTransition();

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const perPerson = playerCount > 0 && total > 0 ? Math.ceil(total / playerCount) : null;

  const handleDelete = (expense: ClubExpense) => {
    setDeletingId(expense.id);
    startDelete(async () => {
      const res = await deleteExpenseAction({ id: expense.id, club_id: expense.club_id });
      if (res && "error" in res) toast.error(res.error);
      else router.refresh();
      setDeletingId(null);
    });
  };

  return (
    <div className="space-y-2">
      {expenses.length === 0 && !showAdd && (
        <p className="text-sm text-muted-foreground">ยังไม่มีรายการค่าใช้จ่าย</p>
      )}

      {expenses.map((expense) =>
        editingId === expense.id ? (
          <ExpenseForm
            key={expense.id}
            defaultValues={{ label: expense.label, amount: expense.amount }}
            onSubmit={async (value) => {
              const res = await updateExpenseAction({
                id: expense.id,
                club_id: expense.club_id,
                ...value,
              });
              if (res && "error" in res) toast.error(res.error);
              else { router.refresh(); setEditingId(null); }
            }}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <div key={expense.id} className="flex items-center gap-2 group">
            <span className="flex-1 text-sm">{expense.label}</span>
            <span className="text-sm font-medium tabular-nums w-28 text-right">
              {Number(expense.amount).toLocaleString()} บาท
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`แก้ไข ${expense.label}`}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => { setEditingId(expense.id); setShowAdd(false); }}
            >
              <Pencil />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`ลบ ${expense.label}`}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
              disabled={deletingId === expense.id}
              onClick={() => handleDelete(expense)}
            >
              {deletingId === expense.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
            </Button>
          </div>
        )
      )}

      {showAdd && (
        <ExpenseForm
          defaultValues={{ label: "", amount: 0 }}
          onSubmit={async (value) => {
            const res = await addExpenseAction({ club_id: clubId, ...value });
            if (res && "error" in res) toast.error(res.error);
            else { router.refresh(); setShowAdd(false); }
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {!showAdd && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setShowAdd(true); setEditingId(null); }}
          >
            <Plus />
            เพิ่มรายการ
          </Button>
        )}

        {total > 0 && (
          <div className="ml-auto text-sm text-right space-y-0.5">
            <div className="font-semibold tabular-nums">
              รวม {total.toLocaleString()} บาท
            </div>
            {perPerson && (
              <div className="text-muted-foreground tabular-nums">
                ต่อคน ~{perPerson.toLocaleString()} บาท
                <span className="text-xs ml-1">({playerCount} คน)</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
