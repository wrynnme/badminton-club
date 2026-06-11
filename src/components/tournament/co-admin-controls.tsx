"use client";

import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { Check, ChevronsUpDown, UserPlus, Trash2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  addCoAdminAction,
  removeCoAdminAction,
  searchProfilesAction,
} from "@/lib/actions/admins";
import type { TournamentAdmin, ProfileSearchResult } from "@/lib/actions/admins";

export function CoAdminControls({
  tournamentId,
  initialAdmins,
}: {
  tournamentId: string;
  initialAdmins: TournamentAdmin[];
}) {
  const t = useTranslations("tournament");
  const [admins, setAdmins] = useState<TournamentAdmin[]>(initialAdmins);
  const [isPending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ProfileSearchResult | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const res = await searchProfilesAction(tournamentId, q);
      if ("ok" in res) setResults(res.results);
      else {
        setResults([]);
        toast.error(res.error);
      }
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, tournamentId]);

  async function handleAdd() {
    if (!selected) return;
    setAdding(true);
    const res = await addCoAdminAction(tournamentId, selected.id);
    setAdding(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(t("coAdminControls.toastAdded"));
    setAdmins((prev) => [
      ...prev,
      {
        tournament_id: tournamentId,
        user_id: selected.id,
        line_user_id: null,
        display_name: selected.display_name,
        added_by: "",
        added_at: new Date().toISOString(),
      },
    ]);
    setSelected(null);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function handleRemove(userId: string) {
    startTransition(async () => {
      const res = await removeCoAdminAction(tournamentId, userId);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(t("coAdminControls.toastRemoved"));
      setAdmins((prev) => prev.filter((a) => a.user_id !== userId));
    });
  }

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <p className="text-sm font-semibold">{t("coAdminControls.title")}</p>

        {admins.filter((a) => a.user_id).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("coAdminControls.emptyAdmins")}</p>
        ) : (
          <ul className="space-y-1">
            {admins
              .filter((a) => a.user_id)
              .map((admin) => (
                <li
                  key={admin.user_id}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {admin.display_name ?? t("coAdminControls.noName")}
                    </p>
                    <p className="text-xs font-mono text-muted-foreground truncate">
                      {admin.line_user_id ?? admin.user_id}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t("coAdminControls.ariaRemove")}
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

        <div className="flex gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  className="flex-1 h-8 justify-between font-normal"
                >
                  <span className="truncate">
                    {selected
                      ? (selected.display_name ?? t("coAdminControls.noName"))
                      : t("coAdminControls.comboboxPlaceholder")}
                  </span>
                  <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
                </Button>
              }
            />
            <PopoverContent
              className="w-(--anchor-width) p-0 gap-0"
              align="start"
            >
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder={t("coAdminControls.inputPlaceholder")}
                  value={query}
                  onValueChange={setQuery}
                />
                <CommandList>
                  <CommandEmpty>
                    {searching
                      ? t("coAdminControls.searching")
                      : query.trim().length === 0
                      ? t("coAdminControls.typeToSearch")
                      : t("coAdminControls.notFound")}
                  </CommandEmpty>
                  <CommandGroup>
                    {results.map((r) => (
                      <CommandItem
                        key={r.id}
                        value={r.id}
                        onSelect={() => {
                          setSelected(r);
                          setOpen(false);
                        }}
                      >
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="truncate">
                            {r.display_name ?? t("coAdminControls.noName")}
                          </span>
                        </div>
                        {selected?.id === r.id && (
                          <Check className="h-4 w-4 shrink-0" />
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0"
            disabled={!selected || adding}
            onClick={handleAdd}
          >
            {adding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-3.5 w-3.5" />
            )}
            {t("coAdminControls.btnAdd")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
