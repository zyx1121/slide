"use client";
// The dock's comments: write a comment on what is selected (shapes, words,
// or the slide in view), and read, answer, resolve or reopen the deck's
// threads. The member comments in batches; their agent reads the open
// threads over MCP and answers with edits. Threads are checked for
// every 10 seconds while the page is visible.
import { MessageSquareIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  commentAction,
  commentsAction,
  threadAction,
} from "@/app/decks/[id]/actions";
import { WHO } from "@/components/editor/who";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Thread } from "@/lib/deck/comments";
import type { Target } from "@/lib/deck/selection";
import { formatDateTime } from "@/lib/format";

const POLL_MS = 10_000;

const time = (date: Date | string) => formatDateTime(new Date(date));

/** What a comment would be on, in a few words. */
function anchorLabel(slideNumber: number, targets: Target[]): string {
  if (targets.length === 0) return `第 ${slideNumber} 頁`;
  if (targets.length === 1 && targets[0].text) {
    return `第 ${slideNumber} 頁的一段文字`;
  }
  return `第 ${slideNumber} 頁的 ${targets.length} 個物件`;
}

export function CommentsTool({
  deckId,
  selection,
  slideNumberOf,
  open,
  onOpenChange,
  focus,
  onJump,
  onThreads,
}: {
  deckId: string;
  /** What a new comment is on: the selection, or the slide in view. */
  selection: { slideId: string; targets: Target[] };
  slideNumberOf: (slideId: string) => number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A thread to show first, as when its pin is clicked. */
  focus: string | null;
  /** Shows a thread's slide with its shapes selected. */
  onJump: (slideId: string, shapes: string[]) => void;
  /** The threads as last loaded, for the pins on the slides. */
  onThreads: (threads: Thread[]) => void;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraft] = useState("");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const loaded = await commentsAction(deckId).catch(() => null);
    if (!loaded) return;
    setThreads(loaded);
    onThreads(loaded);
  }, [deckId, onThreads]);

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

  const run = async (work: () => Promise<{ outcome: string }>) => {
    setWorking(true);
    setNote(null);
    const result = await work().catch(() => null);
    if (!result) setNote("連線中斷，請再試一次。");
    else if (result.outcome === "gone") setNote("這串評論或簡報已經不在了。");
    else if (result.outcome === "invalid")
      setNote("評論沒有存到：選取的東西可能已經改過。");
    await load();
    setWorking(false);
    return result?.outcome === "added";
  };

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    if (await run(() => commentAction(deckId, { ...selection, body }))) {
      setDraft("");
    }
  };

  const openCount = threads.filter((t) => t.status === "open").length;
  const label = openCount > 0 ? `評論：${openCount} 則未結案` : "評論";
  const here = slideNumberOf(selection.slideId);
  const shown = threads
    .filter((t) => showResolved || t.status === "open" || t.id === focus)
    .sort((a, b) => (a.id === focus ? -1 : b.id === focus ? 1 : 0));

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant={openCount > 0 ? "secondary" : "ghost"}
                  className="relative min-w-8 gap-1 px-2 tabular-nums"
                  aria-label={label}
                />
              }
            />
          }
        >
          <MessageSquareIcon />
          {openCount > 0 && <span className="text-xs">{openCount}</span>}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        sideOffset={12}
        data-surface="tinted"
        className="flex w-96 flex-col gap-3"
      >
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="text-xs font-medium" htmlFor="new-comment">
            評論{here ? anchorLabel(here, selection.targets) : "這一頁"}
          </label>
          <Textarea
            id="new-comment"
            value={draft}
            maxLength={5000}
            rows={3}
            placeholder="寫下要改什麼，代理程式會讀到。"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={working || !draft.trim()}>
              送出
            </Button>
          </div>
        </form>

        <section className="flex flex-col gap-2 border-t pt-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium">討論</h2>
            <Button
              variant="ghost"
              onClick={() => setShowResolved((value) => !value)}
            >
              {showResolved ? "只看未結案" : "也看已結案"}
            </Button>
          </div>
          {shown.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              沒有{showResolved ? "" : "未結案的"}評論。
            </p>
          ) : (
            <ol className="flex max-h-80 flex-col gap-3 overflow-y-auto">
              {shown.map((thread) => {
                const number = slideNumberOf(thread.slideId);
                return (
                  <li
                    key={thread.id}
                    className="flex flex-col gap-1 rounded-md px-2 py-1 hover:bg-foreground/5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {number
                          ? anchorLabel(number, thread.targets)
                          : "已刪除的頁面"}{" "}
                        · {WHO[thread.author]} · {time(thread.createdAt)}
                        {thread.status === "resolved" ? " · 已結案" : ""}
                      </span>
                      {number && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            onJump(
                              thread.slideId,
                              thread.targets.map((t) => t.shape)
                            )
                          }
                        >
                          跳到
                        </Button>
                      )}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{thread.body}</p>
                    {thread.replies.map((reply) => (
                      <p
                        key={reply.id}
                        className="border-l pl-2 text-xs whitespace-pre-wrap text-muted-foreground"
                      >
                        {WHO[reply.author]}
                        {reply.kind === "resolve"
                          ? " 結案"
                          : reply.kind === "reopen"
                            ? " 重新打開"
                            : `：${reply.body}`}
                        {reply.entryId ? `（見紀錄 #${reply.entryId}）` : ""}
                      </p>
                    ))}
                    <form
                      className="flex items-end gap-1"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const body = replies[thread.id]?.trim();
                        if (!body) return;
                        const done = await run(() =>
                          threadAction(deckId, thread.id, "reply", body)
                        );
                        if (done)
                          setReplies((all) => ({ ...all, [thread.id]: "" }));
                      }}
                    >
                      <Textarea
                        aria-label="回覆"
                        value={replies[thread.id] ?? ""}
                        maxLength={5000}
                        rows={1}
                        placeholder="回覆"
                        onChange={(event) =>
                          setReplies((all) => ({
                            ...all,
                            [thread.id]: event.target.value,
                          }))
                        }
                      />
                      <Button
                        type="submit"
                        variant="ghost"
                        disabled={working || !replies[thread.id]?.trim()}
                      >
                        回覆
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={working}
                        onClick={() =>
                          void run(() =>
                            threadAction(
                              deckId,
                              thread.id,
                              thread.status === "open" ? "resolve" : "reopen"
                            )
                          )
                        }
                      >
                        {thread.status === "open" ? "結案" : "重開"}
                      </Button>
                    </form>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        {note && (
          <p role="status" className="text-xs text-destructive">
            {note}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
