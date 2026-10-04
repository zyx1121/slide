"use client";

// The dock's suggestions and history: what the member's agent suggested or
// asked for (publishing, deleting), to preview, accept or reject, one by one
// or all at once; and the deck's recent changes, each revertible on its own.
// Suggestions are checked for every 10 seconds while the page is visible.
import { HistoryIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { reviewAction, reviseAction } from "@/app/decks/[id]/actions";
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
import type { Revision, Suggestion } from "@/lib/deck/revisions";

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
  already: "這個建議的內容已經在簡報裡了。",
  gone: "這個項目已經不在了，請重新整理。",
};

export function ReviewTool({
  deckId,
  busy,
  onChanged,
  onPreview,
}: {
  deckId: string;
  /** Edits are still being saved: accepting now could meet a moving deck. */
  busy: boolean;
  /** The deck changed on the server; the editor loads it again. */
  onChanged: () => Promise<void>;
  /** Shows a suggestion applied, or ends the preview with null. */
  onPreview: (suggestion: Suggestion | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const review = await reviewAction(deckId).catch(() => null);
    if (!review) return;
    setSuggestions(review.suggestions);
    setRevisions(review.revisions);
  }, [deckId]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  /** Runs actions one after another, then loads the deck once. */
  const run = async (ids: string[], action: "accept" | "reject" | "revert") => {
    setWorking(true);
    setNote(null);
    onPreview(null);
    let changed = false;
    const problems: string[] = [];
    for (const id of ids) {
      const result = await reviseAction(deckId, id, action).catch(() => null);
      if (!result) problems.push("連線中斷，請再試一次。");
      else if (result.outcome === "applied" && result.kind === "delete") {
        // The deck is gone from the lists; it waits under 最近刪除.
        window.location.assign("/");
        return;
      } else if (result.outcome === "applied") changed = true;
      else if (result.outcome === "conflict") problems.push(result.message);
      else if (MESSAGES[result.outcome])
        problems.push(MESSAGES[result.outcome]);
    }
    if (changed) await onChanged();
    await load();
    setNote(problems[0] ?? null);
    setWorking(false);
  };

  const pending = suggestions.length;
  const label = pending > 0 ? `建議與紀錄：${pending} 個建議` : "建議與紀錄";
  const disabled = working || busy;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onPreview(null);
        else void load();
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant={pending > 0 ? "secondary" : "ghost"}
                  className="relative min-w-8 gap-1 px-2 tabular-nums"
                  aria-label={label}
                />
              }
            />
          }
        >
          <HistoryIcon />
          {pending > 0 && <span className="text-xs">{pending}</span>}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        sideOffset={12}
        data-surface="tinted"
        className="w-96"
      >
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium">代理程式的建議與請求</h2>
            {pending > 1 && (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    run(
                      suggestions.map((s) => s.id),
                      "accept"
                    )
                  }
                >
                  全部接受
                </Button>
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    run(
                      suggestions.map((s) => s.id),
                      "reject"
                    )
                  }
                >
                  全部拒絕
                </Button>
              </div>
            )}
          </div>
          {pending === 0 ? (
            <p className="text-xs text-muted-foreground">
              沒有待處理的建議。代理程式透過 MCP 修改簡報時，會先出現在這裡。
            </p>
          ) : (
            <ol className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {suggestions.map((suggestion) => (
                <li
                  key={suggestion.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-foreground/5"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-xs">
                      {what(suggestion)} · {time(suggestion.createdAt)}
                    </span>
                    {suggestion.stale && (
                      <span className="text-xs text-muted-foreground">
                        簡報在建議之後改過，接受時可能無法套用
                      </span>
                    )}
                  </div>
                  {suggestion.kind === "edit" && (
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => onPreview(suggestion)}
                    >
                      預覽
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => run([suggestion.id], "accept")}
                  >
                    接受
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => run([suggestion.id], "reject")}
                  >
                    拒絕
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="mt-3 flex flex-col gap-2 border-t pt-3">
          <h2 className="text-xs font-medium">修改紀錄</h2>
          <ol className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {revisions
              .filter((revision) => revision.status !== "suggested")
              .map((revision) => (
                <li
                  key={revision.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-foreground/5"
                >
                  <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {time(revision.createdAt)} · {WHO[revision.author]} ·{" "}
                    {what(revision)}
                    {revision.decidedBy &&
                    revision.decidedBy !== revision.author
                      ? ` · ${WHO[revision.decidedBy]}${revision.status === "rejected" ? "拒絕" : "接受"}`
                      : revision.status === "rejected"
                        ? " · 未採用"
                        : ""}
                  </span>
                  {revision.status === "applied" && (
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => run([revision.id], "revert")}
                    >
                      還原
                    </Button>
                  )}
                </li>
              ))}
          </ol>
        </section>
        {note && (
          <p role="status" className="mt-2 text-xs text-destructive">
            {note}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
