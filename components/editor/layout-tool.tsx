"use client";
// The dock's layouts and masters: the slide in view drawn on each layout of
// the deck's master, to pick one, and the masters the deck can move to (the
// built-ins and the masters of files the member imported). A layout is an
// edit like any other, saved and undone with the slide; a master is chosen
// on the server, as an agent's set_master is, and comes back as a refresh.
import { LayoutTemplateIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { mastersAction, setMasterAction } from "@/app/decks/[id]/actions";
import { DockPopover } from "@/components/editor/dock-parts";
import { SlideView } from "@/components/slide-view";
import { Button } from "@/components/ui/button";
import type { DeckDocument } from "@/lib/deck/schema";
import {
  BUILTIN_IDS,
  BUILTIN_MASTERS,
  type BuiltinId,
  layoutOf,
} from "@/lib/master/layout";
import type { MasterSummary } from "@/lib/master/store";
import { cn } from "@/lib/utils";

/** Whether a master from the list is the one the deck is on. */
function isCurrent(document: DeckDocument, master: MasterSummary): boolean {
  const builtin = (BUILTIN_IDS as readonly string[]).includes(master.ref)
    ? BUILTIN_MASTERS[master.ref as BuiltinId]
    : null;
  return builtin
    ? builtin.name === document.master.name &&
        builtin.part === document.master.part
    : master.ref === document.master.file;
}

export function LayoutTool({
  deckId,
  document,
  index,
  disabled,
  onLayout,
  onMasterChanged,
}: {
  deckId: string;
  document: DeckDocument;
  /** The slide in view, by position. */
  index: number;
  disabled: boolean;
  /** Puts the slide in view on a layout, by its index in the master. */
  onLayout: (layout: number) => void;
  /** The deck moved to another master on the server. */
  onMasterChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [masters, setMasters] = useState<MasterSummary[] | null>(null);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    mastersAction()
      .then((list) => live && setMasters(list))
      .catch(() => live && setNote("母片清單載入失敗，請再開一次。"));
    return () => {
      live = false;
    };
  }, [open]);

  const slide = document.slides[index];
  const current = slide.layout ?? document.master.layout;

  const choose = async (ref: string) => {
    setWorking(true);
    setNote(null);
    const result = await setMasterAction(deckId, ref).catch(() => null);
    if (result?.ok) await onMasterChanged();
    else setNote("換母片沒有成功，請再試一次。");
    setWorking(false);
  };

  return (
    <DockPopover
      tip="版面與母片"
      trigger={<LayoutTemplateIcon />}
      panel="flex w-[36rem] max-w-[calc(100vw-2rem)] flex-col gap-3"
      open={open}
      onOpenChange={setOpen}
    >
      <h2 className="text-xs font-medium">這一頁的版面</h2>
      <ol className="grid max-h-72 grid-cols-3 gap-3 overflow-y-auto p-1">
        {document.master.layouts.map((layout, i) => (
          <li key={`${i}-${layout.name}`}>
            <button
              type="button"
              aria-pressed={i === current}
              disabled={disabled}
              onClick={() => onLayout(i)}
              className="flex w-full flex-col gap-1 rounded-lg text-left outline-offset-2 focus-visible:outline-2 disabled:opacity-50"
            >
              <SlideView
                slide={{ ...slide, layout: i }}
                number={index + 1}
                layout={layoutOf(document, { layout: i })}
                decorative
                className={cn(
                  i === current &&
                    "ring-2 ring-foreground ring-offset-2 ring-offset-popover"
                )}
              />
              <span className="truncate text-xs text-muted-foreground">
                {layout.name || `版面 ${i + 1}`}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <h2 className="text-xs font-medium">母片</h2>
      <p className="text-xs text-muted-foreground">
        換母片時，每一頁換到同名的版面；沒有同名的，換到母片的預設版面。
      </p>
      <ul className="flex max-h-48 flex-col overflow-y-auto">
        {masters === null && !note && (
          <li className="px-2 text-xs text-muted-foreground">載入中</li>
        )}
        {masters?.map((master) => {
          const on = isCurrent(document, master);
          return (
            <li key={master.ref}>
              <Button
                variant="ghost"
                className="w-full justify-between"
                aria-pressed={on}
                disabled={disabled || working || on}
                onClick={() => void choose(master.ref)}
              >
                <span className="truncate">{master.name}</span>
                <span className="text-xs text-muted-foreground">
                  {on ? "使用中" : `${master.layouts.length} 個版面`}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
      {note && <p className="text-xs text-destructive">{note}</p>}
    </DockPopover>
  );
}
