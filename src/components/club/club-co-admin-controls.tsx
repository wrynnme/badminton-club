"use client";

import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { Check, ChevronsUpDown, UserPlus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  addClubCoAdminAction,
  removeClubCoAdminAction,
  searchClubProfilesAction,
} from "@/lib/actions/clubs";
import type { ClubAdmin, ClubProfileSearchResult } from "@/lib/actions/clubs";

export function ClubCoAdminControls({
  clubId,
  initialAdmins,
}: {
  clubId: string;
  initialAdmins: ClubAdmin[];
}) {
  const [admins, setAdmins] = useState<ClubAdmin[]>(initialAdmins);
  const [isPending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClubProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ClubProfileSearchResult | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await searchClubProfilesAction(clubId, q);
      if ("ok" in res) setResults(res.results);
      else {
        setResults([]);
        toast.error(res.error);
      }
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query, clubId]);

  async function handleAdd() {
    if (!selected?.line_user_id) {
      toast.error("ผู้ใช้นี้ไม่มี LINE account");
      return;
    }
    setAdding(true);
    const res = await addClubCoAdminAction(clubId, selected.line_user_id);
    setAdding(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success("เพิ่ม co-admin แล้ว");
    setAdmins((prev) => [
      ...prev,
      {
        club_id: clubId,
        user_id: selected.id,
        display_name: selected.display_name,
        line_user_id: selected.line_user_id,
        added_by: null,
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
      const res = await removeClubCoAdminAction(clubId, userId);
      if ("error" in res) { toast.error(res.error); return; }
      toast.success("ลบ co-admin แล้ว");
      setAdmins((prev) => prev.filter((a) => a.user_id !== userId));
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">ผู้ช่วยดูแล (Co-admin)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {admins.length === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีผู้ช่วยดูแล</p>
        ) : (
          <ul className="space-y-1">
            {admins.map((admin) => (
              <li key={admin.user_id} className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {admin.display_name ?? "(ไม่มีชื่อ)"}
                  </p>
                  <p className="text-xs font-mono text-muted-foreground truncate">
                    {admin.line_user_id ?? admin.user_id}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`ลบ ${admin.display_name ?? "co-admin"}`}
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
                      ? (selected.display_name ?? selected.line_user_id ?? "(ไม่มีชื่อ)")
                      : "ค้นหาผู้ใช้..."}
                  </span>
                  <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
                </Button>
              }
            />
            <PopoverContent className="w-(--anchor-width) p-0 gap-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="พิมพ์ชื่อ..."
                  value={query}
                  onValueChange={setQuery}
                />
                <CommandList>
                  <CommandEmpty>
                    {searching
                      ? "กำลังค้นหา..."
                      : query.trim().length === 0
                      ? "พิมพ์ชื่อเพื่อค้นหา"
                      : "ไม่พบผู้ใช้"}
                  </CommandEmpty>
                  <CommandGroup>
                    {results.map((r) => (
                      <CommandItem
                        key={r.id}
                        value={r.id}
                        onSelect={() => { setSelected(r); setOpen(false); }}
                      >
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="truncate">{r.display_name ?? "(ไม่มีชื่อ)"}</span>
                          <span className="text-xs font-mono text-muted-foreground truncate">
                            {r.line_user_id}
                          </span>
                        </div>
                        {selected?.id === r.id && <Check className="h-4 w-4 shrink-0" />}
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
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
            เพิ่ม
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
