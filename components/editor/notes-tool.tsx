"use client";
// The dock's speaker notes: the notes of the slide in view, written here and
// shown below the slides in the presenter view. Typing is saved as one edit
// when it pauses, when the field loses focus and when the panel closes,
// always to the slide it was typed for, even if another slide came into
// view meanwhile. Notes changed elsewhere show while nothing is being typed.
import { NotebookPenIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { DockPopover } from "@/components/editor/dock-parts";
import { Textarea } from "@/components/ui/textarea";
import { NOTES_MAX } from "@/lib/deck/limits";

/** How long typing pauses before it is saved, as for text on a slide. */
const SAVE_DELAY = 800;

type Typed = { slideId: string; text: string };

export function NotesTool({
  slideId,
  slideNumber,
  notes,
  disabled,
  onSave,
}: {
  /** The slide in view, whose notes are shown. */
  slideId: string;
  slideNumber: number;
  /** Its notes as the editor has them. */
  notes: string;
  /** While edits are paused, the notes can be read but not changed. */
  disabled: boolean;
  /** Saves a slide's notes; false when the edit could not be made. */
  onSave: (slideId: string, notes: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  // What is typed and not saved yet, with the slide it is for.
  const [typed, setTyped] = useState<Typed | null>(null);
  const typedRef = useRef<Typed | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const save = useCallback(() => {
    clearTimeout(timer.current);
    const pending = typedRef.current;
    if (!pending) return;
    // Kept when the edit could not be made, so nothing typed is lost.
    if (!onSaveRef.current(pending.slideId, pending.text)) return;
    typedRef.current = null;
    setTyped(null);
  }, []);
  // Whatever is still typed is saved when the editor closes.
  useEffect(() => save, [save]);

  const change = (text: string) => {
    if (typedRef.current && typedRef.current.slideId !== slideId) save();
    typedRef.current = { slideId, text };
    setTyped(typedRef.current);
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY);
  };

  const value = typed?.slideId === slideId ? typed.text : notes;
  const has = notes.trim().length > 0;
  const label = has ? `講稿：第 ${slideNumber} 頁有講稿` : "講稿";

  return (
    <DockPopover
      tip={label}
      trigger={<NotebookPenIcon />}
      button={{ variant: has ? "secondary" : "ghost" }}
      panel="flex w-[min(36rem,calc(100vw-2rem))] flex-col gap-2"
      open={open}
      onOpenChange={(next) => {
        if (!next) save();
        setOpen(next);
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-xs font-medium" htmlFor="slide-notes">
          第 {slideNumber} 頁的講稿
        </label>
        <span className="text-xs text-muted-foreground">
          簡報者模式顯示在投影片下方
        </span>
      </div>
      <Textarea
        id="slide-notes"
        value={value}
        maxLength={NOTES_MAX}
        rows={8}
        disabled={disabled}
        placeholder="寫下這一頁要講的話。"
        className="max-h-[50dvh] min-h-40"
        onChange={(event) => change(event.target.value)}
        onBlur={save}
      />
    </DockPopover>
  );
}
