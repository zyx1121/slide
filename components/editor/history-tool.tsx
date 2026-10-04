"use client";
// The dock's history: every change to the deck, the member's and their
// agent's, newest first, each revertible on its own. Changes apply at once;
// the history is how one is taken back.
import { HistoryIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { historyAction, revertAction } from "@/app/decks/[id]/actions";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Revision } from "@/lib/deck/revisions";

const POLL_MS = 10_000;

const time = (date: Date | string) =>
  new Date(date).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const ACTIONS: Record<Exclude<Revision["kind"], "edit">, string> = {
  publish: "公開分享",
  unpublish: "取消公開",
  delete: "刪除簡報",
  restore: "還原簡報",
};

/** What an entry does, in a few words. */
const what = (entry: Revision) =>
  entry.kind === "edit" ? `${entry.changes} 處修改` : ACTIONS[entry.kind];

const WHO = { member: "你", agent: "代理程式" } as const;

const MESSAGES: Record<string, string> = {
  already: "這一筆的結果已經不在了，不用還原。",
  gone: "這個項目已經不在了，請重新整理。",
};

export function HistoryTool({
  deckId,
  busy,
  onChanged,
}: {
  deckId: string;
  /** Edits are still being saved: reverting now could meet a moving deck. */
  busy: boolean;
  /** The deck changed on the server; the editor loads it again. */
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const history = await historyAction(deckId).catch(() => null);
    if (history) setRevisions(history.revisions);
  }, [deckId]);

  // Kept current while open, since an agent may be changing the deck.
  useEffect(() => {
    if (!open) return;
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, open]);

  const revert = async (id: string) => {
    setWorking(true);
    setNote(null);
    const result = await revertAction(deckId, id).catch(() => null);
    if (!result) setNote("連線中斷，請再試一次。");
    else if (result.outcome === "applied" && result.kind === "delete") {
      // The deck is gone from the lists; it waits under 最近刪除.
      router.push("/");
      return;
    } else if (result.outcome === "applied") await onChanged();
    else if (result.outcome === "conflict") setNote(result.message);
    else setNote(MESSAGES[result.outcome] ?? null);
    await load();
    setWorking(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<Button variant="ghost" size="icon" aria-label="紀錄" />}
            />
          }
        >
          <HistoryIcon />
        </TooltipTrigger>
        <TooltipContent>紀錄</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        sideOffset={12}
        data-surface="tinted"
        className="flex w-96 flex-col gap-2"
      >
        <h2 className="text-xs font-medium">修改紀錄</h2>
        <p className="text-xs text-muted-foreground">
          你和代理程式的修改都會馬上生效，每一筆都可以單獨還原。
        </p>
        <ol className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {revisions.map((revision) => (
            <li
              key={revision.id}
              className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-foreground/5"
            >
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                #{revision.id} · {time(revision.createdAt)} ·{" "}
                {WHO[revision.author]} · {what(revision)}
                {revision.status === "rejected" ? " · 未採用" : ""}
              </span>
              {revision.status === "applied" && (
                <Button
                  variant="ghost"
                  disabled={working || busy}
                  onClick={() => void revert(revision.id)}
                >
                  還原
                </Button>
              )}
            </li>
          ))}
        </ol>
        {note && (
          <p role="status" className="text-xs text-destructive">
            {note}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
