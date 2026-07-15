"use client";

import { useState, useTransition, type ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Shared typed-name destructive-delete dialog (used by `DeleteClubButton` and
 * `SeriesDangerZone`'s delete button): the confirm button only enables once the
 * user types `expectedName` verbatim (trim-compared). Owns the open/typed/
 * pending state — closing the dialog resets the typed value. `onConfirm` runs
 * inside a transition and is responsible for its own error toast / navigation;
 * the dialog does not auto-close (a successful delete navigates away).
 */
export function TypedDeleteDialog({
  renderTrigger,
  title,
  description,
  body,
  expectedName,
  inputId,
  inputLabel,
  cancelLabel,
  confirmLabel,
  pendingLabel,
  contentClassName = "sm:max-w-sm",
  onConfirm,
}: {
  /** Render the trigger button; call `open()` to show the dialog (lets callers wrap it in a Tooltip). */
  renderTrigger: (open: () => void) => ReactNode;
  title: ReactNode;
  description: ReactNode;
  /** Optional extra content between the header and the confirm input (e.g. cascade bullets). */
  body?: ReactNode;
  expectedName: string;
  inputId: string;
  inputLabel: ReactNode;
  cancelLabel: ReactNode;
  confirmLabel: ReactNode;
  pendingLabel: ReactNode;
  contentClassName?: string;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();

  const confirmed = typed.trim() === expectedName.trim();

  function handleConfirm() {
    if (!confirmed) return;
    start(async () => {
      await onConfirm();
    });
  }

  return (
    <>
      {renderTrigger(() => setOpen(true))}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setTyped("");
        }}
      >
        <DialogContent className={contentClassName}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              {title}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {body}

          <div className="space-y-1.5">
            <Label htmlFor={inputId}>{inputLabel}</Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={expectedName}
              autoComplete="off"
              disabled={pending}
            />
          </div>

          <DialogFooter className="gap-2">
            <DialogClose render={<Button variant="outline" disabled={pending}>{cancelLabel}</Button>} />
            <Button variant="destructive" onClick={handleConfirm} disabled={!confirmed || pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
