"use client";

import { CsvImportDialog } from "@/components/tournament/csv-import-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntityLink } from "@/components/tournament/stats/entity-link";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addTeamPlayerAction, bulkCheckInTeamAction, createTeamAction, deleteTeamAction, removeTeamPlayerAction, resetAllCheckInsAction, toggleTeamPlayerCheckInAction, updateTeamPlayerAction } from "@/lib/actions/tournaments";
import { fieldErrors } from "@/lib/form-errors";
import type { Level, TeamWithPlayers } from "@/lib/types";
import { useForm } from "@tanstack/react-form";
import { Check, CheckCheck, ChevronDown, ChevronUp, Loader2, Pencil, Plus, RotateCcw, Trash2, UserCheck, UserMinus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import * as z from "zod";

const NONE_SENTINEL = "__none__";

const COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];

function AddTeamForm({ tournamentId, onDone }: { tournamentId: string; onDone: () => void }) {
  const t = useTranslations("tournament");

  const teamSchema = z.object({
    name: z.string().min(1, t("teamManager.teamNameRequired")),
    color: z.string(),
  });

  const form = useForm({
    defaultValues: { name: "", color: COLORS[0] },
    validators: { onSubmit: teamSchema },
    onSubmit: async ({ value }) => {
      const res = await createTeamAction({ tournament_id: tournamentId, ...value });
      if (res?.error) toast.error(res.error);
      else { toast.success(t("teamManager.toastTeamAdded")); onDone(); }
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-3 pt-3 border-t">
      <FieldGroup>
        <form.Field name="name" children={(field) => {
          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>{t("teamManager.fieldTeamName")}</FieldLabel>
              <Input id={field.name} value={field.state.value} onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)} placeholder={t("teamManager.placeholderTeamName")} />
              {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
            </Field>
          );
        }} />
        <form.Field name="color" children={(field) => (
          <Field>
            <FieldLabel>{t("teamManager.fieldTeamColor")}</FieldLabel>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button key={c} type="button"
                  aria-label={t("teamManager.ariaColor", { color: c })}
                  aria-pressed={field.state.value === c}
                  className={`w-7 h-7 cursor-pointer rounded-full border-2 transition-all ${field.state.value === c ? "border-foreground scale-110" : "border-transparent"}`}
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
            <Button type="submit" size="sm" disabled={!can || sub}>{sub && <Loader2 className="h-4 w-4 animate-spin" />}{sub ? t("teamManager.btnAdding") : t("teamManager.btnAddTeam")}</Button>
          )}
        </form.Subscribe>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>{t("teamManager.btnCancel")}</Button>
      </div>
    </form>
  );
}

function AddMemberForm({ teamId, tournamentId, levels, onDone }: { teamId: string; tournamentId: string; levels: Level[]; onDone: () => void }) {
  const t = useTranslations("tournament");

  const memberSchema = z.object({
    display_name: z.string().min(1, t("teamManager.memberNameRequired")),
    role: z.enum(["captain", "member"]),
    level_id: z.string(),
  });

  const form = useForm({
    defaultValues: { display_name: "", role: "member" as "captain" | "member", level_id: NONE_SENTINEL },
    validators: { onSubmit: memberSchema },
    onSubmit: async ({ value }) => {
      const level_id = value.level_id && value.level_id !== NONE_SENTINEL ? value.level_id : null;
      const res = await addTeamPlayerAction(teamId, { display_name: value.display_name, role: value.role, level_id }, tournamentId);
      if (res?.error) toast.error(res.error);
      else { toast.success(t("teamManager.toastMemberAdded")); form.reset(); onDone(); }
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="pt-2 border-t mt-2 space-y-2">
      <FieldGroup>
        <form.Field name="display_name" children={(field) => {
          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>{t("teamManager.fieldMemberName")}</FieldLabel>
              <Input id={field.name} value={field.state.value} onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)} placeholder={t("teamManager.placeholderMemberName")} autoFocus />
              {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
            </Field>
          );
        }} />
        <form.Field name="role" children={(field) => (
          <Field>
            <FieldLabel>{t("teamManager.fieldRole")}</FieldLabel>
            <div className="flex gap-2">
              {([
                { value: "member", label: t("teamManager.roleMember") },
                { value: "captain", label: t("teamManager.roleCaptain") },
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
        <form.Field name="level_id" children={(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>{t("teamManager.fieldLevel")}</FieldLabel>
            <Select
              value={field.state.value}
              onValueChange={(v) => field.handleChange(v ?? NONE_SENTINEL)}
            >
              <SelectTrigger id={field.name} className="w-full">
                <SelectValue>
                  {(v: string) => {
                    if (!v || v === NONE_SENTINEL) return t("teamManager.levelNone");
                    return levels.find((l) => l.id === v)?.label ?? t("teamManager.levelNone");
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_SENTINEL}>{t("teamManager.levelNone")}</SelectItem>
                {levels.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.label} ({l.real})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )} />
      </FieldGroup>
      <div className="flex gap-2">
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
          {([can, sub]) => (
            <Button type="submit" size="sm" disabled={!can || sub}>{sub && <Loader2 className="h-4 w-4 animate-spin" />}{sub ? t("teamManager.btnAdding") : t("teamManager.btnAdd")}</Button>
          )}
        </form.Subscribe>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>{t("teamManager.btnCancel")}</Button>
      </div>
    </form>
  );
}

function PlayerRow({ p, tournamentId, isOwner, levels, startRemove }: {
  p: TeamWithPlayers["players"][number];
  tournamentId: string;
  isOwner: boolean;
  levels: Level[];
  startRemove: (fn: () => Promise<void>) => void;
}) {
  const t = useTranslations("tournament");
  const levelById = new Map(levels.map((l) => [l.id, l.label]));
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.display_name);
  const [levelId, setLevelId] = useState(p.level_id ?? NONE_SENTINEL);
  const [editPending, startEdit] = useTransition();
  const [checkPending, startCheck] = useTransition();
  const isCheckedIn = !!p.checked_in_at;

  const toggleCheckIn = () => startCheck(async () => {
    const res = await toggleTeamPlayerCheckInAction({ playerId: p.id, tournamentId });
    if (res?.error) toast.error(res.error);
  });

  const save = () => startEdit(async () => {
    const level_id = levelId && levelId !== NONE_SENTINEL ? levelId : null;
    const res = await updateTeamPlayerAction(p.id, { display_name: name, level_id }, tournamentId);
    if (res?.error) { toast.error(res.error); setName(p.display_name); setLevelId(p.level_id ?? NONE_SENTINEL); }
    else toast.success(t("teamManager.toastPlayerEdited"));
    setEditing(false);
  });

  const cancel = () => { setEditing(false); setName(p.display_name); setLevelId(p.level_id ?? NONE_SENTINEL); };

  const currentLevelLabel = p.level_id ? levelById.get(p.level_id) : undefined;

  return (
    <li className={`flex items-center gap-2 text-sm rounded px-1 py-0.5 ${isCheckedIn ? "bg-green-500/5 border border-green-500/30" : ""}`}>
      {p.role === "captain" && <Badge className="text-xs px-1 py-0 shrink-0">{t("teamManager.badgeCaptain")}</Badge>}
      {editing ? (
        <>
          <Input value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
            className="h-6 text-xs flex-1 px-1.5 min-w-0" autoFocus />
          <Select value={levelId} onValueChange={(v) => setLevelId(v ?? NONE_SENTINEL)}>
            <SelectTrigger className="h-6 text-xs w-28 px-1.5">
              <SelectValue>
                {(v: string) => {
                  if (!v || v === NONE_SENTINEL) return t("teamManager.levelPlaceholder");
                  return levels.find((l) => l.id === v)?.label ?? t("teamManager.levelPlaceholder");
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_SENTINEL}>{t("teamManager.levelNone")}</SelectItem>
              {levels.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.label} ({l.real})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label={t("teamManager.ariaSave")} disabled={editPending} onClick={save}>
            {editPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label={t("teamManager.btnCancel")} disabled={editPending} onClick={cancel}><X className="h-3 w-3" /></Button>
        </>
      ) : (
        <>
          <EntityLink entityType="player" entityId={p.id} className="flex-1 truncate">{name}</EntityLink>
          {currentLevelLabel && <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">{currentLevelLabel}</Badge>}
          {isOwner && (
            <Button variant={isCheckedIn ? "default" : "outline"} size="sm"
              className={`h-6 px-2 text-[10px] shrink-0 ${isCheckedIn ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
              aria-label={isCheckedIn ? t("teamManager.ariaCancelCheckIn", { name }) : t("teamManager.ariaCheckIn", { name })}
              disabled={checkPending} onClick={toggleCheckIn}>
              {checkPending ? <Loader2 className="h-3 w-3 animate-spin" /> : isCheckedIn ? <><UserCheck className="h-3 w-3 mr-1" />{t("teamManager.btnReady")}</> : t("teamManager.btnCheckIn")}
            </Button>
          )}
          {isOwner && (
            <>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={t("teamManager.ariaEdit")}
                onClick={() => setEditing(true)}><Pencil className="h-3 w-3" /></Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
                aria-label={t("teamManager.ariaRemovePlayer")}
                onClick={() => startRemove(async () => {
                  const res = await removeTeamPlayerAction(p.id, tournamentId);
                  if (res?.error) toast.error(res.error);
                  else toast.success(t("teamManager.toastPlayerRemoved"));
                })}><UserMinus className="h-3 w-3" /></Button>
            </>
          )}
        </>
      )}
    </li>
  );
}

function TeamCard({ team, tournamentId, isOwner, levels }: { team: TeamWithPlayers; tournamentId: string; isOwner: boolean; levels: Level[] }) {
  const t = useTranslations("tournament");
  const [open, setOpen] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [delPending, startDel] = useTransition();
  const [removePending, startRemove] = useTransition();
  const [bulkPending, startBulk] = useTransition();
  const checkedInCount = team.players.filter((p) => p.checked_in_at).length;
  const allCheckedIn = team.players.length > 0 && checkedInCount === team.players.length;

  const toggleBulk = () => {
    const intendCheckIn = !allCheckedIn;
    startBulk(async () => {
      const res = await bulkCheckInTeamAction({ teamId: team.id, tournamentId, checkIn: intendCheckIn });
      if (res?.error) { toast.error(res.error); return; }
      if (res.noop) { toast.info(intendCheckIn ? t("teamManager.toastBulkAllReady") : t("teamManager.toastBulkNoneReady")); return; }
      toast.success(intendCheckIn
        ? t("teamManager.toastBulkCheckIn", { name: team.name, count: res.count ?? 0 })
        : t("teamManager.toastBulkCheckOut", { name: team.name, count: res.count ?? 0 }));
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {team.color && <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: team.color }} />}
            <CardTitle className="text-sm truncate">
              <EntityLink entityType="team" entityId={team.id}>{team.name}</EntityLink>
            </CardTitle>
            <Badge variant="outline" className="text-xs shrink-0">{team.players.length}</Badge>
            {checkedInCount > 0 && (
              <Badge className={`text-xs shrink-0 ${allCheckedIn ? "bg-green-600 text-white" : "bg-green-500/15 text-green-700 dark:text-green-400"}`}>
                {t("teamManager.badgeCheckedIn", { checked: checkedInCount, total: team.players.length })}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isOwner && team.players.length > 0 && (
              <Button variant="ghost" size="icon" className="h-7 w-7"
                aria-label={allCheckedIn ? t("teamManager.ariaBulkCheckOut", { name: team.name }) : t("teamManager.ariaBulkCheckIn", { name: team.name })}
                disabled={bulkPending} onClick={toggleBulk}>
                {bulkPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className={`h-3.5 w-3.5 ${allCheckedIn ? "text-green-600" : "text-muted-foreground"}`} />}
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7"
              aria-label={open ? t("teamManager.ariaCollapse") : t("teamManager.ariaExpand")}
              onClick={() => { setOpen(!open); setAddingMember(false); }}>
              {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
            {isOwner && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                aria-label={t("teamManager.ariaDeleteTeam")}
                disabled={delPending}
                onClick={() => startDel(async () => {
                  const res = await deleteTeamAction(team.id, tournamentId);
                  if (res?.error) toast.error(res.error);
                  else toast.success(t("teamManager.toastTeamDeleted"));
                })}>
                {delPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2">
          {team.players.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("teamManager.emptyMembers")}</p>
          ) : (
            <ul className="space-y-1">
              {[...team.players].sort((a, b) => (a.role === "captain" ? -1 : b.role === "captain" ? 1 : 0)).map((p) => (
                <PlayerRow key={p.id} p={p} tournamentId={tournamentId} isOwner={isOwner} levels={levels} startRemove={startRemove} />
              ))}
            </ul>
          )}

          {isOwner && !addingMember && (
            <Button size="sm" variant="outline" className="w-full h-7 text-xs"
              aria-label={t("teamManager.ariaAddMember", { name: team.name })}
              onClick={() => setAddingMember(true)}>
              <Plus className="h-3 w-3 mr-1" />{t("teamManager.btnAddMember")}
            </Button>
          )}

          {isOwner && addingMember && (
            <AddMemberForm
              teamId={team.id}
              tournamentId={tournamentId}
              levels={levels}
              onDone={() => setAddingMember(false)}
            />
          )}
        </CardContent>
      )}
    </Card>
  );
}

export function TeamManager({ tournamentId, teams, isOwner, teamCount, levels }: {
  tournamentId: string;
  teams: TeamWithPlayers[];
  isOwner: boolean;
  teamCount: number;
  levels: Level[];
}) {
  const t = useTranslations("tournament");
  const [adding, setAdding] = useState(false);
  const [resetPending, startReset] = useTransition();
  const remaining = teamCount - teams.length;
  const totalCheckedIn = teams.reduce((n, tm) => n + tm.players.filter((p) => p.checked_in_at).length, 0);

  const resetAll = () => {
    if (!confirm(t("teamManager.confirmReset", { count: totalCheckedIn }))) return;
    startReset(async () => {
      const res = await resetAllCheckInsAction(tournamentId);
      if (res?.error) toast.error(res.error);
      else if (res.noop) toast.info(t("teamManager.toastResetNoOne"));
      else toast.success(t("teamManager.toastResetDone", { count: res.count ?? 0 }));
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{t("teamManager.sectionTeams")}</h2>
          <Badge variant="outline">{teams.length}/{teamCount}</Badge>
          {totalCheckedIn > 0 && (
            <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">{t("teamManager.badgeTotalReady", { count: totalCheckedIn })}</Badge>
          )}
        </div>
        {isOwner && (
          <div className="flex items-center gap-2">
            {totalCheckedIn > 0 && (
              <Button size="sm" variant="outline" disabled={resetPending} onClick={resetAll}>
                {resetPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                {t("teamManager.btnResetCheckIn")}
              </Button>
            )}
            <CsvImportDialog tournamentId={tournamentId} onlyMode="players" />
            {remaining > 0 && !adding && (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4 mr-1" />{t("teamManager.btnAddTeam")}
              </Button>
            )}
          </div>
        )}
      </div>

      {teams.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">{t("teamManager.emptyTeams")}</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {teams.map((tm) => (
          <TeamCard key={tm.id} team={tm} tournamentId={tournamentId} isOwner={isOwner} levels={levels} />
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
        <p className="text-xs text-muted-foreground">{t("teamManager.badgeTeamsFull", { count: teamCount })}</p>
      )}
    </div>
  );
}
