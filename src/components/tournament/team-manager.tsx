"use client";

import * as z from "zod";
import { useState, useTransition } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Plus, Trash2, ChevronDown, ChevronUp, UserMinus, Pencil, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { createTeamAction, deleteTeamAction, addTeamPlayerAction, removeTeamPlayerAction, updateTeamPlayerAction } from "@/lib/actions/tournaments";
import { CsvImportDialog } from "@/components/tournament/csv-import-dialog";
import type { TeamWithPlayers } from "@/lib/types";

const teamSchema = z.object({
  name: z.string().min(1, "ระบุชื่อทีม"),
  color: z.string(),
});


const memberSchema = z.object({
  display_name: z.string().min(1, "ระบุชื่อสมาชิก"),
  role: z.enum(["captain", "member"]),
  level: z.string(),
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
                  aria-label={`สี ${c}`}
                  aria-pressed={field.state.value === c}
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
            <Button type="submit" size="sm" disabled={!can || sub}>{sub && <Loader2 className="h-4 w-4 animate-spin" />}{sub ? "กำลังเพิ่ม..." : "เพิ่มทีม"}</Button>
          )}
        </form.Subscribe>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>ยกเลิก</Button>
      </div>
    </form>
  );
}

function AddMemberForm({ teamId, tournamentId, onDone }: { teamId: string; tournamentId: string; onDone: () => void }) {
  const form = useForm({
    defaultValues: { display_name: "", role: "member" as "captain" | "member", level: "" },
    validators: { onSubmit: memberSchema },
    onSubmit: async ({ value }) => {
      const res = await addTeamPlayerAction({ team_id: teamId, tournament_id: tournamentId, ...value });
      if (res?.error) toast.error(res.error);
      else { toast.success("เพิ่มสมาชิกแล้ว"); form.reset(); onDone(); }
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="pt-2 border-t mt-2 space-y-2">
      <FieldGroup>
        <form.Field name="display_name" children={(field) => {
          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>ชื่อสมาชิก *</FieldLabel>
              <Input id={field.name} value={field.state.value} onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)} placeholder="ชื่อ-นามสกุล" autoFocus />
              {isInvalid && <FieldError errors={field.state.meta.errors.map(e => ({ message: String(e) }))} />}
            </Field>
          );
        }} />
        <form.Field name="role" children={(field) => (
          <Field>
            <FieldLabel>ตำแหน่ง</FieldLabel>
            <div className="flex gap-2">
              {([
                { value: "member", label: "สมาชิก" },
                { value: "captain", label: "หัวหน้าทีม" },
              ] as const).map((opt) => (
                <Button key={opt.value} type="button" size="sm"
                  variant={field.state.value === opt.value ? "default" : "outline"}
                  onClick={() => field.handleChange(opt.value)}>
                  {opt.label}
                </Button>
              ))}
            </div>
          </Field>
        )} />
        <form.Field name="level" children={(field) => (
          <Field>
            <FieldLabel>Level</FieldLabel>
            <Input type="number" step="0.5" value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="เช่น 3.5" className="w-28" />
          </Field>
        )} />
      </FieldGroup>
      <div className="flex gap-2">
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
          {([can, sub]) => (
            <Button type="submit" size="sm" disabled={!can || sub}>{sub && <Loader2 className="h-4 w-4 animate-spin" />}{sub ? "กำลังเพิ่ม..." : "เพิ่ม"}</Button>
          )}
        </form.Subscribe>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>ยกเลิก</Button>
      </div>
    </form>
  );
}

function PlayerRow({ p, tournamentId, isOwner, startRemove }: {
  p: TeamWithPlayers["players"][number];
  tournamentId: string;
  isOwner: boolean;
  startRemove: (fn: () => Promise<void>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.display_name);
  const [level, setLevel] = useState(p.level ?? "");
  const [, startEdit] = useTransition();

  const save = () => startEdit(async () => {
    const res = await updateTeamPlayerAction(p.id, { display_name: name, level: level || null }, tournamentId);
    if (res?.error) { toast.error(res.error); setName(p.display_name); setLevel(p.level ?? ""); }
    setEditing(false);
  });

  const cancel = () => { setEditing(false); setName(p.display_name); setLevel(p.level ?? ""); };

  return (
    <li className="flex items-center gap-2 text-sm">
      {p.role === "captain" && <Badge className="text-xs px-1 py-0 shrink-0">หัวหน้า</Badge>}
      {editing ? (
        <>
          <Input value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
            className="h-6 text-xs flex-1 px-1.5 min-w-0" autoFocus />
          <Input type="number" step="0.5" value={level} onChange={(e) => setLevel(e.target.value)}
            placeholder="Level" className="h-6 text-xs w-16 px-1.5" />
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label="บันทึก" onClick={save}><Check className="h-3 w-3" /></Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label="ยกเลิก" onClick={cancel}><X className="h-3 w-3" /></Button>
        </>
      ) : (
        <>
          <span className="flex-1 truncate">{name}</span>
          {p.level && <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">{p.level}</Badge>}
          {isOwner && (
            <>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="แก้ไข"
                onClick={() => setEditing(true)}><Pencil className="h-3 w-3" /></Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
                aria-label="ลบผู้เล่น"
                onClick={() => startRemove(async () => {
                  const res = await removeTeamPlayerAction(p.id, tournamentId);
                  if (res?.error) toast.error(res.error);
                })}><UserMinus className="h-3 w-3" /></Button>
            </>
          )}
        </>
      )}
    </li>
  );
}

function TeamCard({ team, tournamentId, isOwner }: { team: TeamWithPlayers; tournamentId: string; isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [, startDel] = useTransition();
  const [, startRemove] = useTransition();

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
            <Button variant="ghost" size="icon" className="h-7 w-7"
              aria-label={open ? "เลื่อนขึ้น" : "เลื่อนลง"}
              onClick={() => { setOpen(!open); setAddingMember(false); }}>
              {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
            {isOwner && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                aria-label="ลบทีม"
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
        <CardContent className="pt-0 space-y-2">
          {team.players.length === 0 ? (
            <p className="text-xs text-muted-foreground">ยังไม่มีสมาชิก</p>
          ) : (
            <ul className="space-y-1">
              {[...team.players].sort((a, b) => (a.role === "captain" ? -1 : b.role === "captain" ? 1 : 0)).map((p) => (
                <PlayerRow key={p.id} p={p} tournamentId={tournamentId} isOwner={isOwner} startRemove={startRemove} />
              ))}
            </ul>
          )}

          {isOwner && !addingMember && (
            <Button size="sm" variant="outline" className="w-full h-7 text-xs"
              onClick={() => setAddingMember(true)}>
              <Plus className="h-3 w-3 mr-1" />เพิ่มสมาชิก
            </Button>
          )}

          {isOwner && addingMember && (
            <AddMemberForm
              teamId={team.id}
              tournamentId={tournamentId}
              onDone={() => setAddingMember(false)}
            />
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
        {isOwner && (
          <div className="flex items-center gap-2">
            <CsvImportDialog tournamentId={tournamentId} onlyMode="players" />
            {remaining > 0 && !adding && (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4 mr-1" />เพิ่มทีม
              </Button>
            )}
          </div>
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
