"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "@bprogress/next/app";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, GripVertical, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useForm, useStore } from "@tanstack/react-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  createClassAction,
  updateClassAction,
  deleteClassAction,
  reorderClassesAction,
  type ClassInput,
} from "@/lib/actions/classes";
import { fieldErrors } from "@/lib/form-errors";
import type { TournamentClass, TournamentFormat, MatchFormat } from "@/lib/types";

// ─── props ──────────────────────────────────────────────────────────────────

type Props = {
  tournamentId: string;
  classes: TournamentClass[];
  isOwner: boolean;
};

// ─── add / edit dialog ───────────────────────────────────────────────────────

type ClassFormValues = {
  code: string;
  name: string;
  pair_capacity: number | null;
  pairs_per_group: number;
  format: TournamentFormat;
  advance_count: number;
  has_lower_bracket: boolean;
  allow_drop_to_lower: boolean;
  match_format: MatchFormat;
};

const DEFAULT_VALUES: ClassFormValues = {
  code: "",
  name: "",
  pair_capacity: null,
  pairs_per_group: 4,
  format: "group_knockout",
  advance_count: 2,
  has_lower_bracket: false,
  allow_drop_to_lower: false,
  match_format: "best_of_3",
};

function ClassFormDialog({
  open,
  onClose,
  editing,
  tournamentId,
}: {
  open: boolean;
  onClose: () => void;
  editing: TournamentClass | null;
  tournamentId: string;
}) {
  const t = useTranslations("tournament");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // zod schema defined inside component so t() is available
  const classSchema = z.object({
    code: z.string().min(1, t("classManager.errorCodeRequired")),
    name: z.string().min(1, t("classManager.errorNameRequired")),
    pair_capacity: z.number().int().positive(t("classManager.errorCapacityPositive")).nullable(),
    pairs_per_group: z.number().int().min(1, t("classManager.errorMinOne")),
    format: z.enum(["group_only", "group_knockout", "knockout_only"]),
    advance_count: z.number().int().min(1, t("classManager.errorMinOne")),
    has_lower_bracket: z.boolean(),
    allow_drop_to_lower: z.boolean(),
    match_format: z.enum(["fixed_2", "best_of_3", "best_of_5"]),
  });

  // FORMAT_LABEL defined inside component so t() is available
  const FORMAT_LABEL: Record<TournamentFormat, string> = {
    group_only: t("classManager.formatGroupOnly"),
    group_knockout: t("classManager.formatGroupKnockout"),
    knockout_only: t("classManager.formatKnockoutOnly"),
  };

  const initialValues: ClassFormValues = editing
    ? {
        code: editing.code,
        name: editing.name,
        pair_capacity: editing.pair_capacity,
        pairs_per_group: editing.pairs_per_group,
        format: editing.format,
        advance_count: editing.advance_count,
        has_lower_bracket: editing.has_lower_bracket,
        allow_drop_to_lower: editing.allow_drop_to_lower,
        match_format: editing.match_format,
      }
    : DEFAULT_VALUES;

  const form = useForm({
    defaultValues: initialValues,
    validators: { onSubmit: classSchema },
    onSubmit: async ({ value }) => {
      const input: ClassInput = {
        code: value.code,
        name: value.name,
        pair_capacity: value.pair_capacity,
        pairs_per_group: value.pairs_per_group,
        format: value.format as TournamentFormat,
        advance_count: value.advance_count,
        has_lower_bracket: value.has_lower_bracket,
        allow_drop_to_lower: value.allow_drop_to_lower,
        match_format: value.match_format as MatchFormat,
      };
      startTransition(async () => {
        const res = editing
          ? await updateClassAction(editing.id, input)
          : await createClassAction(tournamentId, input);
        if ("error" in res) {
          toast.error(res.error);
          return;
        }
        toast.success(editing ? t("classManager.toastUpdated") : t("classManager.toastAdded"));
        router.refresh();
        onClose();
      });
    },
  });

  // Watch format to conditionally show advance_count / has_lower_bracket
  const format = useStore(form.store, (s) => s.values.format);
  const hasLowerBracket = useStore(form.store, (s) => s.values.has_lower_bracket);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t("classManager.dialogTitleEdit") : t("classManager.dialogTitleAdd")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}
          className="space-y-4 pt-1"
        >
          <FieldGroup>
            {/* code */}
            <form.Field name="code">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{t("classManager.fieldCode")}</FieldLabel>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder={t("classManager.placeholderCode")}
                      maxLength={20}
                    />
                    {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                  </Field>
                );
              }}
            </form.Field>

            {/* name */}
            <form.Field name="name">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{t("classManager.fieldName")}</FieldLabel>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder={t("classManager.placeholderName")}
                    />
                    {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                  </Field>
                );
              }}
            </form.Field>

            {/* pair_capacity */}
            <form.Field name="pair_capacity">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>
                      {t("classManager.fieldCapacity")}
                    </FieldLabel>
                    <Input
                      id={field.name}
                      type="number"
                      min={1}
                      value={field.state.value ?? ""}
                      onBlur={field.handleBlur}
                      onChange={(e) =>
                        field.handleChange(e.target.value === "" ? null : Number(e.target.value))
                      }
                      placeholder={t("classManager.placeholderCapacity")}
                    />
                    {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                  </Field>
                );
              }}
            </form.Field>

            {/* format */}
            <form.Field name="format">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>{t("classManager.fieldFormat")}</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v as TournamentFormat)}
                  >
                    <SelectTrigger id={field.name} className="w-full">
                      <SelectValue>
                        {(v: string) => FORMAT_LABEL[v as TournamentFormat] ?? v}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="group_only">{t("classManager.formatGroupOnly")}</SelectItem>
                      <SelectItem value="group_knockout">{t("classManager.formatGroupKnockout")}</SelectItem>
                      <SelectItem value="knockout_only">{t("classManager.formatKnockoutOnly")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>

            {/* pairs_per_group — only shown when format includes groups */}
            {format !== "knockout_only" && (
              <form.Field name="pairs_per_group">
                {(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>{t("classManager.fieldPairsPerGroup")}</FieldLabel>
                      <Input
                        id={field.name}
                        type="number"
                        min={1}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(Number(e.target.value))}
                      />
                      {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                    </Field>
                  );
                }}
              </form.Field>
            )}

            {/* advance_count — only when format includes knockout */}
            {format === "group_knockout" && (
              <form.Field name="advance_count">
                {(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>{t("classManager.fieldAdvanceCount")}</FieldLabel>
                      <Input
                        id={field.name}
                        type="number"
                        min={1}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(Number(e.target.value))}
                      />
                      {isInvalid && <FieldError errors={fieldErrors(field.state.meta.errors)} />}
                    </Field>
                  );
                }}
              </form.Field>
            )}

            {/* has_lower_bracket */}
            {format !== "group_only" && (
              <form.Field name="has_lower_bracket">
                {(field) => (
                  <Field>
                    <div className="flex items-center gap-2 py-1">
                      <Checkbox
                        id={field.name}
                        checked={field.state.value}
                        onCheckedChange={(v) => field.handleChange(v === true)}
                      />
                      <Label htmlFor={field.name} className="text-sm cursor-pointer">
                        {t("classManager.checkboxLowerBracket")}
                      </Label>
                    </div>
                  </Field>
                )}
              </form.Field>
            )}

            {/* allow_drop_to_lower — only meaningful when has_lower_bracket is on */}
            {format !== "group_only" && hasLowerBracket && (
              <form.Field name="allow_drop_to_lower">
                {(field) => (
                  <Field>
                    <div className="flex items-center gap-2 py-1">
                      <Checkbox
                        id={field.name}
                        checked={field.state.value}
                        onCheckedChange={(v) => field.handleChange(v === true)}
                      />
                      <Label htmlFor={field.name} className="text-sm cursor-pointer">
                        {t("classManager.checkboxDropToLower")}
                      </Label>
                    </div>
                  </Field>
                )}
              </form.Field>
            )}

            {/* match_format */}
            <form.Field name="match_format">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>{t("classManager.fieldMatchFormat")}</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v as MatchFormat)}
                  >
                    <SelectTrigger id={field.name} className="w-full">
                      <SelectValue>
                        {(v: string) => v ? t(`matchFormat.${v as MatchFormat}`) : ""}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(["fixed_2", "best_of_3", "best_of_5"] as MatchFormat[]).map((fmt) => (
                        <SelectItem key={fmt} value={fmt}>
                          {t(`matchFormat.${fmt}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
          </FieldGroup>

          {/* submit */}
          <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <div className="flex gap-2 pt-1">
                <Button
                  type="submit"
                  disabled={!canSubmit || isSubmitting || isPending}
                  className="flex-1"
                >
                  {(isSubmitting || isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editing ? t("classManager.btnSave") : t("classManager.btnAddClass")}
                </Button>
                <Button type="button" variant="ghost" onClick={onClose}>
                  {t("classManager.btnCancel")}
                </Button>
              </div>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── sortable row ────────────────────────────────────────────────────────────

function SortableClassRow({
  cls,
  disabled,
  onEdit,
  onDelete,
  formatLabel,
}: {
  cls: TournamentClass;
  disabled: boolean;
  onEdit: (cls: TournamentClass) => void;
  onDelete: (cls: TournamentClass) => void;
  formatLabel: (f: TournamentFormat) => string;
}) {
  const t = useTranslations("tournament");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cls.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="border-b last:border-0 touch-none"
    >
      {/* drag handle */}
      <td className="w-8 pl-2 py-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                {...attributes}
                {...listeners}
                aria-label={t("classManager.ariaGrip")}
                className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
                disabled={disabled}
              >
                <GripVertical className="h-4 w-4" />
              </button>
            }
          />
          <TooltipContent>{t("classManager.tooltipGrip")}</TooltipContent>
        </Tooltip>
      </td>

      <td className="py-2 px-2 text-sm font-mono font-medium">{cls.code}</td>
      <td className="py-2 px-2 text-sm">{cls.name}</td>
      <td className="py-2 px-2 text-sm text-muted-foreground text-center">
        {cls.pair_capacity ?? "—"}
      </td>
      <td className="py-2 px-2 text-sm text-center">{cls.pairs_per_group}</td>
      <td className="py-2 px-2 text-xs text-muted-foreground hidden sm:table-cell">
        {formatLabel(cls.format)}
      </td>
      <td className="py-2 px-2 text-sm text-center hidden sm:table-cell">{cls.advance_count}</td>
      <td className="py-2 px-2 text-xs text-muted-foreground hidden md:table-cell">
        {t(`matchFormat.${cls.match_format}`)}
      </td>

      {/* actions */}
      <td className="py-2 pr-2 text-right">
        <div className="flex justify-end gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("classManager.ariaEdit", { code: cls.code })}
                  onClick={() => onEdit(cls)}
                  disabled={disabled}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <TooltipContent>{t("classManager.tooltipEdit", { code: cls.code, name: cls.name })}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("classManager.ariaDelete", { code: cls.code })}
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(cls)}
                  disabled={disabled}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <TooltipContent>{t("classManager.tooltipDelete", { code: cls.code, name: cls.name })}</TooltipContent>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

export function ClassManager({ tournamentId, classes: initialClasses, isOwner }: Props) {
  const t = useTranslations("tournament");
  const router = useRouter();
  const [classes, setClasses] = useState<TournamentClass[]>(initialClasses);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TournamentClass | null>(null);
  const [savePending, startSave] = useTransition();
  const [deletePending, startDelete] = useTransition();

  // FORMAT_LABEL defined inside component so t() is available
  const FORMAT_LABEL: Record<TournamentFormat, string> = {
    group_only: t("classManager.formatGroupOnly"),
    group_knockout: t("classManager.formatGroupKnockout"),
    knockout_only: t("classManager.formatKnockoutOnly"),
  };

  // Serialized-write refs for reorder — same pattern as court-manager
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<unknown> | null>(null);
  const lastSavedRef = useRef<TournamentClass[]>(initialClasses);

  // Sync when server refreshes provide a new list
  useEffect(() => {
    setClasses(initialClasses);
    lastSavedRef.current = initialClasses;
  }, [initialClasses]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Debounced + serialized reorder — mirrors court-manager exactly.
  // Rapid drags collapse into one write; each write awaits the previous.
  const saveOrder = (next: TournamentClass[]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      startSave(async () => {
        if (inFlightRef.current) {
          try { await inFlightRef.current; } catch {}
        }
        const ids = next.map((c) => c.id);
        const p = reorderClassesAction(tournamentId, ids);
        inFlightRef.current = p;
        const res = await p;
        inFlightRef.current = null;
        if (res && "error" in res) {
          toast.error(res.error);
          setClasses(lastSavedRef.current);
        } else {
          lastSavedRef.current = next;
          router.refresh();
        }
      });
    }, 250);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = classes.findIndex((c) => c.id === active.id);
    const newIndex = classes.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(classes, oldIndex, newIndex);
    setClasses(next);
    saveOrder(next);
  };

  const handleDelete = (cls: TournamentClass) => {
    if (!confirm(t("classManager.confirmDelete", { code: cls.code, name: cls.name }))) return;
    startDelete(async () => {
      const res = await deleteClassAction(cls.id);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("classManager.toastDeleted", { code: cls.code }));
      router.refresh();
    });
  };

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (cls: TournamentClass) => {
    setEditing(cls);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
  };

  const isDisabled = savePending || deletePending;

  // If not owner, show read-only list
  if (!isOwner) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Event Classes ({classes.length})</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("classManager.emptyNoClass")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-1.5 px-2">{t("classManager.colCode")}</th>
                    <th className="text-left py-1.5 px-2">{t("classManager.colName")}</th>
                    <th className="text-center py-1.5 px-2">{t("classManager.colCapacity")}</th>
                    <th className="text-center py-1.5 px-2 hidden sm:table-cell">{t("classManager.colFormat")}</th>
                    <th className="text-center py-1.5 px-2 hidden md:table-cell">{t("classManager.colMatchFormat")}</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.map((cls) => (
                    <tr key={cls.id} className="border-b last:border-0">
                      <td className="py-2 px-2 font-mono font-medium">{cls.code}</td>
                      <td className="py-2 px-2">{cls.name}</td>
                      <td className="py-2 px-2 text-center text-muted-foreground">
                        {cls.pair_capacity ?? "—"}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground hidden sm:table-cell">
                        {FORMAT_LABEL[cls.format]}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground hidden md:table-cell">
                        {t(`matchFormat.${cls.match_format}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            Event Classes ({classes.length})
            {isDisabled && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </CardTitle>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button size="sm" onClick={openAdd} disabled={isDisabled}>
                  <Plus className="h-3.5 w-3.5 mr-1" />{t("classManager.btnAddClass")}
                </Button>
              }
            />
            <TooltipContent>{t("classManager.tooltipAddClass")}</TooltipContent>
          </Tooltip>
        </CardHeader>
        <CardContent className="pt-0">
          {classes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              {t("classManager.emptyHint")}
            </p>
          ) : (
            <DndContext
              id="class-manager-dnd"
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="w-8" />
                      <th className="text-left py-1.5 px-2">{t("classManager.colCode")}</th>
                      <th className="text-left py-1.5 px-2">{t("classManager.colName")}</th>
                      <th className="text-center py-1.5 px-2">{t("classManager.colCapacity")}</th>
                      <th className="text-center py-1.5 px-2">{t("classManager.colPairsPerGroup")}</th>
                      <th className="text-left py-1.5 px-2 hidden sm:table-cell">{t("classManager.colFormat")}</th>
                      <th className="text-center py-1.5 px-2 hidden sm:table-cell">{t("classManager.colAdvance")}</th>
                      <th className="text-left py-1.5 px-2 hidden md:table-cell">{t("classManager.colMatchFormat")}</th>
                      <th className="text-right py-1.5 pr-2">Actions</th>
                    </tr>
                  </thead>
                  <SortableContext items={classes.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                    <tbody>
                      {classes.map((cls) => (
                        <SortableClassRow
                          key={cls.id}
                          cls={cls}
                          disabled={isDisabled}
                          onEdit={openEdit}
                          onDelete={handleDelete}
                          formatLabel={(f) => FORMAT_LABEL[f]}
                        />
                      ))}
                    </tbody>
                  </SortableContext>
                </table>
              </div>
            </DndContext>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit dialog — remounted on editing change so defaultValues reset */}
      <ClassFormDialog
        key={editing ? editing.id : "__add__"}
        open={dialogOpen}
        onClose={closeDialog}
        editing={editing}
        tournamentId={tournamentId}
      />
    </>
  );
}
