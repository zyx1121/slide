"use client";
// The dock's layouts: the slide in view drawn on each layout of the deck's
// master, to pick one. A layout is an edit like any other, saved and undone
// with the slide. The master itself is chosen when the deck is made.
import { LayoutTemplateIcon } from "lucide-react";
import { useState } from "react";

import { DockPopover } from "@/components/editor/dock-parts";
import { SlideView } from "@/components/slide-view";
import type { DeckDocument } from "@/lib/deck/schema";
import { layoutOf } from "@/lib/master/layout";
import { cn } from "@/lib/utils";

export function LayoutTool({
  document,
  index,
  disabled,
  onLayout,
}: {
  document: DeckDocument;
  /** The slide in view, by position. */
  index: number;
  disabled: boolean;
  /** Puts the slide in view on a layout, by its index in the master. */
  onLayout: (layout: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const slide = document.slides[index];
  const current = slide.layout ?? document.master.layout;

  return (
    <DockPopover
      tip="版面"
      trigger={<LayoutTemplateIcon />}
      panel="w-[36rem] max-w-[calc(100vw-2rem)]"
      open={open}
      onOpenChange={setOpen}
    >
      <ol className="grid max-h-[60dvh] grid-cols-3 gap-3 overflow-y-auto p-1">
        {document.master.layouts.map((layout, i) => (
          <li key={`${i}-${layout.name}`}>
            <button
              type="button"
              aria-pressed={i === current}
              disabled={disabled}
              onClick={() => {
                onLayout(i);
                setOpen(false);
              }}
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
                {layout.name || `${i + 1}`}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </DockPopover>
  );
}
