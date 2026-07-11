"use client";

/**
 * ClubLinkControls — manager-only card for LINE linking (see docs/adr/0001).
 *
 * Two parts:
 *  1. Join link — generate / copy (via ShareLinkRow + QR) / revoke a per-club
 *     `join_token`. Players open /clubs/join/[token], log in with LINE, and land
 *     in the pool.
 *  2. Link pool — pending requests (LINE name + picture). A manager links a
 *     request to a guest roster row (name-choice dialog) or dismisses it.
 *
 * Only public profile fields (display_name, picture_url) reach this component;
 * line_user_id never leaves the server.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter as useProgressRouter } from "@bprogress/next/app";
import { Link2, Link2Off, Loader2, UserPlus, X, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShareLinkRow } from "@/components/share-link-row";
import {
  generateClubJoinTokenAction,
  revokeClubJoinTokenAction,
  linkClubPlayerAction,
  dismissClubLinkRequestAction,
} from "@/lib/actions/club-linking";
import type { ClubLinkPoolRequest } from "@/lib/types";

type GuestOption = { id: string; display_name: string };

export function ClubLinkControls({
  clubId,
  joinToken,
  appUrl,
  pendingRequests,
  guestPlayers,
}: {
  clubId: string;
  joinToken: string | null;
  appUrl: string;
  pendingRequests: ClubLinkPoolRequest[];
  guestPlayers: GuestOption[];
}) {
  const t = useTranslations("club.linking");
  const [token, setToken] = useState(joinToken);
  const [tokenPending, startToken] = useTransition();
  const [linkTarget, setLinkTarget] = useState<ClubLinkPoolRequest | null>(null);

  const generate = () =>
    startToken(async () => {
      const res = await generateClubJoinTokenAction(clubId);
      if (res && "error" in res) {
        toast.error(res.error);
        return;
      }
      if (res && "token" in res) setToken(res.token);
      toast.success(t("toastLinkGenerated"));
    });

  const revoke = () =>
    startToken(async () => {
      const res = await revokeClubJoinTokenAction(clubId);
      if (res && "error" in res) {
        toast.error(res.error);
        return;
      }
      setToken(null);
      toast.success(t("toastLinkRevoked"));
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{t("desc")}</p>

        {/* Join link */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">{t("joinLinkLabel")}</Label>
          {token ? (
            <ShareLinkRow
              appUrl={appUrl}
              path={`/clubs/join/${token}`}
              qrTitle={t("qrTitle")}
              trailing={
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 shrink-0 text-destructive hover:text-destructive"
                        aria-label={t("btnRevoke")}
                        onClick={revoke}
                        disabled={tokenPending}
                      >
                        <Link2Off className="h-3.5 w-3.5" />
                      </Button>
                    }
                  />
                  <TooltipContent>{t("tipRevoke")}</TooltipContent>
                </Tooltip>
              }
            />
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={generate}
                    className="self-start"
                    disabled={tokenPending}
                  >
                    {tokenPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5" />
                    )}
                    {tokenPending ? t("btnGenerating") : t("btnGenerate")}
                  </Button>
                }
              />
              <TooltipContent>{t("tipGenerate")}</TooltipContent>
            </Tooltip>
          )}
          <p className="text-xs text-muted-foreground">{t("joinLinkHint")}</p>
        </div>

        {/* Link pool */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            {t("poolHeading", { count: pendingRequests.length })}
          </h3>
          {pendingRequests.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("poolEmpty")}</p>
          ) : (
            <ul className="space-y-2">
              {pendingRequests.map((req) => (
                <PoolRow
                  key={req.id}
                  clubId={clubId}
                  req={req}
                  onLink={() => setLinkTarget(req)}
                />
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      {linkTarget && (
        <LinkDialog
          clubId={clubId}
          req={linkTarget}
          guestPlayers={guestPlayers}
          open={!!linkTarget}
          onOpenChange={(v) => {
            if (!v) setLinkTarget(null);
          }}
        />
      )}
    </Card>
  );
}

function PoolRow({
  clubId,
  req,
  onLink,
}: {
  clubId: string;
  req: ClubLinkPoolRequest;
  onLink: () => void;
}) {
  const t = useTranslations("club.linking");
  const router = useProgressRouter();
  const [pending, start] = useTransition();

  const dismiss = () =>
    start(async () => {
      const res = await dismissClubLinkRequestAction({ clubId, requestId: req.id });
      if (res && "error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toastDismissed"));
      router.refresh();
    });

  return (
    <li className="flex items-center gap-2 rounded-md border p-2">
      <Avatar size="sm">
        <AvatarImage src={req.profile.picture_url ?? undefined} alt="" />
        <AvatarFallback>{req.profile.display_name.slice(0, 1)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate text-sm">{req.profile.display_name}</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0"
              onClick={onLink}
              disabled={pending}
            >
              <UserPlus className="h-3.5 w-3.5" />
              {t("btnLink")}
            </Button>
          }
        />
        <TooltipContent>{t("tipLink")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 text-destructive hover:text-destructive"
              onClick={dismiss}
              disabled={pending}
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              {t("btnDismiss")}
            </Button>
          }
        />
        <TooltipContent>{t("tipDismiss")}</TooltipContent>
      </Tooltip>
    </li>
  );
}

function LinkDialog({
  clubId,
  req,
  guestPlayers,
  open,
  onOpenChange,
}: {
  clubId: string;
  req: ClubLinkPoolRequest;
  guestPlayers: GuestOption[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useTranslations("club.linking");
  const router = useProgressRouter();
  const lineName = req.profile.display_name;
  const [guestId, setGuestId] = useState<string>(guestPlayers[0]?.id ?? "");
  const [useLineName, setUseLineName] = useState(false); // default: keep the guest name
  const [pending, start] = useTransition();

  const selectedGuest = guestPlayers.find((g) => g.id === guestId);

  const confirm = () =>
    start(async () => {
      const res = await linkClubPlayerAction({
        clubId,
        requestId: req.id,
        targetPlayerId: guestId,
        useLineName,
      });
      if (res && "error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("toastLinked"));
      router.refresh();
      onOpenChange(false);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription className="text-xs">
            {t("dialogDesc", { name: lineName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Pick the guest row */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("pickGuestLabel")}</Label>
            {guestPlayers.length === 0 ? (
              <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                {t("noGuests")}
              </p>
            ) : (
              <Select value={guestId} onValueChange={(v) => { if (v) setGuestId(v); }}>
                <SelectTrigger size="sm" className="h-8 w-full text-sm">
                  <SelectValue>
                    {() => selectedGuest?.display_name ?? t("pickGuestPlaceholder")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {guestPlayers.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Name choice — default keep the manager-curated guest name */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("nameChoiceLabel")}</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={!useLineName ? "default" : "outline"}
                className="h-auto flex-col items-start gap-0 py-2"
                onClick={() => setUseLineName(false)}
              >
                <span className="text-[10px] opacity-70">{t("keepName")}</span>
                <span className="max-w-full truncate text-sm font-medium">
                  {selectedGuest?.display_name ?? "—"}
                </span>
              </Button>
              <Button
                type="button"
                variant={useLineName ? "default" : "outline"}
                className="h-auto flex-col items-start gap-0 py-2"
                onClick={() => setUseLineName(true)}
              >
                <span className="text-[10px] opacity-70">{t("useLineName")}</span>
                <span className="max-w-full truncate text-sm font-medium">{lineName}</span>
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                  {t("cancel")}
                </Button>
              }
            />
            <TooltipContent>{t("tipCancel")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button onClick={confirm} disabled={pending || !guestId}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  {t("confirmLink")}
                </Button>
              }
            />
            <TooltipContent>{t("tipConfirm")}</TooltipContent>
          </Tooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
