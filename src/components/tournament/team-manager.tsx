"use client";

import * as z from "zod";
import { useState, useTransition } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { createTeamAction, deleteTeamAction } from "@/lib/actions/tournaments";
import type { TeamWithPlayers } from "@/lib/types";

const teamSchema = z.object({
  name: z.string().min(1, "ระบุชื่อทีม"),
  color: z.string(),
});

const COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];

function AddTeamForm({ tournamentId, onDone }: { tournamentId: string; onDone: () => void }) {
  const form = useForm({
    defaultValues: { name: "", color: COLORS[0] },
    validators: { onSubmit: teamSchema },
    onSubmit: async ({ value }) => {
      const res = await createTeamAction({ tournament_id: tournamentId, ...value });
      if (res?.error) toast.error(res.error);
      else { toast.success("เพิ่มทีมแล้ว"); onDone(); }
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-3 pt-3 border-t">
      <FieldGroup>
        <form.Field name="name" children={(field) => {
          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>ชื่อทีม *</FieldLabel>
              <Input id={field.name} value={field.state.value} onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)} placeholder="เช่น ทีมแดง" />
              {isInvalid && <FieldError errors={field.state.meta.errors.map(e => ({ message: String(e) }))} />}
            </Field>
          );
        }} />
        <form.Field name="color" children={(field) => (
          <Field>
            <FieldLabel>สีทีม</FieldLabel>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button key={c} type="button"
                  className={`w-7 h-7 rounded-full border-2 transition-all ${field.state.value === c ? "border-foreground scale-110" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                  onClick={() => field.handleChange(c)} />
              ))}
            </div>
          </Field>
        )} />
      </FieldGroup>
      <div className="flex gap-2">
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
          {([can, sub]) => (
            <Button type="submit" size="sm" disabled={!can || sub}>{sub ? "กำลังเพิ่ม..." : "เพิ่มทีม"}</Button>
          )}
        </form.Subscribe>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>ยกเลิก</Button>
      </div>
    </form>
  );
}

function TeamCard({ team, tournamentId, isOwner }: { team: TeamWithPlayers; tournamentId: string; isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [, startDel] = useTransition();

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {team.color && <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: team.color }} />}
            <CardTitle className="text-sm">{team.name}</CardTitle>
            <Badge variant="outline" className="text-xs">{team.players.length} คน</Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(!open)}>
              {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
            {isOwner && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => startDel(async () => {
                  const res = await deleteTeamAction(team.id, tournamentId);
                  if (res?.error) toast.error(res.error);
                })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          {team.players.length === 0 ? (
            <p className="text-xs text-muted-foreground">ยังไม่มีสมาชิก</p>
          ) : (
            <ul className="space-y-1">
              {team.players.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  {p.role === "captain" && <Badge className="text-xs px-1 py-0">หัวหน้า</Badge>}
                  <span>{p.display_name}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export function TeamManager({ tournamentId, teams, isOwner, teamCount }: {
  tournamentId: string;
  teams: TeamWithPlayers[];
  isOwner: boolean;
  teamCount: number;
}) {
  const [adding, setAdding] = useState(false);
  const remaining = teamCount - teams.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">ทีม</h2>
          <Badge variant="outline">{teams.length}/{teamCount}</Badge>
        </div>
        {isOwner && remaining > 0 && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4 mr-1" />เพิ่มทีม
          </Button>
        )}
      </div>

      {teams.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">ยังไม่มีทีม — กด "เพิ่มทีม" เพื่อเริ่ม</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {teams.map((t) => (
          <TeamCard key={t.id} team={t} tournamentId={tournamentId} isOwner={isOwner} />
        ))}
      </div>

      {adding && (
        <Card>
          <CardContent className="pt-4">
            <AddTeamForm tournamentId={tournamentId} onDone={() => setAdding(false)} />
          </CardContent>
        </Card>
      )}

      {remaining <= 0 && isOwner && (
        <p className="text-xs text-muted-foreground">ครบ {teamCount} ทีมแล้ว</p>
      )}
    </div>
  );
}
