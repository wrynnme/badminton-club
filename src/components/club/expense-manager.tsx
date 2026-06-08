"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { useForm } from "@tanstack/react-form";
import * as z from "zod";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Checkbox } from "@/components/ui/checkbox";
import { addExpenseAction, updateExpenseAction, deleteExpenseAction } from "@/lib/actions/clubs";
import type { ClubExpense } from "@/lib/actions/clubs";

const expenseSchema = z.object({
  label: z.string().min(1, "ระบุชื่อรายการ"),
  amount: z.number().min(0, "จำนวนเงินไม่ถูกต้อง"),
  payer_player_ids: z.array(z.string()),
});

type ExpensePlayer = { id: string; display_name: string };

// ─── Shared form ──────────────────────────────────────────────────────────────

function ExpenseForm({
  defaultValues,
  players,
  onSubmit,
  onCancel,
}: {
  defaultValues: { label: string; amount: number; payer_player_ids: string[] };
  players: ExpensePlayer[];
  onSubmit: (value: { label: string; amount: number; payer_player_ids: string[] }) => Promise<void>;
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
      className="space-y-2"
    >
      {/* Label + Amount + Submit row */}
      <div className="flex items-center gap-2">
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
              <NumberInput
                min={0}
                step={1}
                placeholder="0"
                value={field.state.value}
                onValueChange={field.handleChange}
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
      </div>

      {/* Payer selector */}
      {players.length > 0 && (
        <form.Field name="payer_player_ids">
          {(field) => {
            const ids: string[] = field.state.value ?? [];
            return (
              <div className="rounded-md border border-input bg-muted/40 p-2 space-y-1.5">
                <p className="text-xs text-muted-foreground font-medium">
                  ใครจ่าย <span className="font-normal">(ไม่เลือก = ทุกคนหาร)</span>
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {players.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-1.5 cursor-pointer select-none"
                    >
                      <Checkbox
                        checked={ids.includes(p.id)}
                        onCheckedChange={(checked) => {
                          field.handleChange(
                            checked
                              ? [...ids, p.id]
                              : ids.filter((x) => x !== p.id)
                          );
                        }}
                      />
                      <span className="text-xs">{p.display_name}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          }}
        </form.Field>
      )}
    </form>
  );
}

// ─── Per-row payer sub-line ───────────────────────────────────────────────────

function PayerSubLine({
  expense,
  players,
  playerCount,
}: {
  expense: ClubExpense;
  players: ExpensePlayer[];
  playerCount: number;
}) {
  const ids: string[] = expense.payer_player_ids ?? [];
  const amount = Number(expense.amount);

  if (ids.length === 0) {
    // Everyone pays
    const headcount = playerCount;
    const perPerson = headcount > 0 ? Math.ceil(amount / headcount) : null;
    return (
      <span className="text-xs text-muted-foreground tabular-nums">
        ทุกคนหาร
        {perPerson !== null ? ` · ${amount.toLocaleString()}/${headcount} = ${perPerson.toLocaleString()} ฿/คน` : ""}
      </span>
    );
  }

  // Specific payers
  const headcount = ids.length;
  const perPerson = headcount > 0 ? Math.ceil(amount / headcount) : null;
  const nameMap = new Map(players.map((p) => [p.id, p.display_name]));
  const names = ids.map((id) => nameMap.get(id) ?? "?").join(", ");
  const MAX_NAMES_LEN = 40;
  const displayNames = names.length > MAX_NAMES_LEN ? names.slice(0, MAX_NAMES_LEN) + "…" : names;

  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {headcount} คน: {displayNames}
      {perPerson !== null ? ` · ${perPerson.toLocaleString()} ฿/คน` : ""}
    </span>
  );
}

// ─── Per-player rollup ────────────────────────────────────────────────────────

function PlayerRollup({
  expenses,
  players,
  playerCount,
}: {
  expenses: ClubExpense[];
  players: ExpensePlayer[];
  playerCount: number;
}) {
  if (expenses.length === 0 || players.length === 0) return null;

  // For each player, sum ceil(amount / effective_headcount) for expenses they're part of
  const totals = players.map((player) => {
    let total = 0;
    for (const expense of expenses) {
      const ids: string[] = expense.payer_player_ids ?? [];
      const amount = Number(expense.amount);
      const isDesignated = ids.length > 0 && ids.includes(player.id);
      const isEveryone = ids.length === 0;
      if (!isDesignated && !isEveryone) continue;
      const headcount = ids.length > 0 ? ids.length : playerCount;
      if (headcount <= 0) continue;
      total += Math.ceil(amount / headcount);
    }
    return { player, total };
  });

  // Only show players who owe something
  const relevant = totals.filter((t) => t.total > 0);
  if (relevant.length === 0) return null;

  return (
    <div className="rounded-md border border-input bg-muted/30 p-3 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        ยอดต่อคน (จาก expense) <span className="font-normal">· ปัดขึ้น (ceil)</span>
      </p>
      <div className="space-y-1">
        {relevant.map(({ player, total }) => (
          <div key={player.id} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{player.display_name}</span>
            <span className="tabular-nums font-medium">{total.toLocaleString()} ฿</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ExpenseManager({
  clubId,
  expenses,
  playerCount,
  players,
}: {
  clubId: string;
  expenses: ClubExpense[];
  playerCount: number;
  players: ExpensePlayer[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startDelete] = useTransition();

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);

  const handleDelete = (expense: ClubExpense) => {
    setDeletingId(expense.id);
    startDelete(async () => {
      const res = await deleteExpenseAction({ id: expense.id, club_id: expense.club_id });
      if (res && "error" in res) toast.error(res.error);
      else { toast.success("ลบรายการแล้ว"); router.refresh(); }
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
            players={players}
            defaultValues={{
              label: expense.label,
              amount: expense.amount,
              payer_player_ids: expense.payer_player_ids ?? [],
            }}
            onSubmit={async (value) => {
              const res = await updateExpenseAction({
                id: expense.id,
                club_id: expense.club_id,
                label: value.label,
                amount: value.amount,
                payer_player_ids: value.payer_player_ids,
              });
              if (res && "error" in res) toast.error(res.error);
              else { toast.success("บันทึกรายการแล้ว"); router.refresh(); setEditingId(null); }
            }}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <div key={expense.id} className="group">
            <div className="flex items-center gap-2">
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
            <PayerSubLine expense={expense} players={players} playerCount={playerCount} />
          </div>
        )
      )}

      {showAdd && (
        <ExpenseForm
          players={players}
          defaultValues={{ label: "", amount: 0, payer_player_ids: [] }}
          onSubmit={async (value) => {
            const res = await addExpenseAction({
              club_id: clubId,
              label: value.label,
              amount: value.amount,
              payer_player_ids: value.payer_player_ids,
            });
            if (res && "error" in res) toast.error(res.error);
            else { toast.success("เพิ่มรายการแล้ว"); router.refresh(); setShowAdd(false); }
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
          <div className="ml-auto text-sm text-right">
            <div className="font-semibold tabular-nums">
              รวม {total.toLocaleString()} บาท
            </div>
          </div>
        )}
      </div>

      <PlayerRollup expenses={expenses} players={players} playerCount={playerCount} />
    </div>
  );
}
