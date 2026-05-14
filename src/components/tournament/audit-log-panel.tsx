"use client";

import { useState } from "react";
import { format } from "date-fns";
import { th } from "date-fns/locale";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAuditLogsAction } from "@/lib/actions/admins";
import type { AuditLogEntry } from "@/lib/actions/admins";

export function AuditLogPanel({ tournamentId }: { tournamentId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchLogs() {
    if (logs !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getAuditLogsAction(tournamentId);
      if ("error" in res) {
        setError(res.error);
      } else {
        setLogs(res.logs);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleToggle() {
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      fetchLogs();
    }
  }

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">ประวัติการแก้ไข</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleToggle}
            className="h-7 gap-1 text-xs"
          >
            {isOpen ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                ซ่อน
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                แสดง
              </>
            )}
          </Button>
        </div>

        {isOpen && (
          <>
            {loading && (
              <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
            )}

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            {!loading && !error && logs !== null && logs.length === 0 && (
              <p className="text-sm text-muted-foreground">ยังไม่มีประวัติ</p>
            )}

            {!loading && !error && logs !== null && logs.length > 0 && (
              <ul className="space-y-1.5">
                {logs.map((log) => (
                  <li key={log.id} className="text-xs text-muted-foreground flex gap-2">
                    <span className="shrink-0 tabular-nums">
                      {format(new Date(log.created_at), "d MMM HH:mm", { locale: th })}
                    </span>
                    <span className="shrink-0 font-medium text-foreground">{log.actor_name}</span>
                    <span>{log.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
