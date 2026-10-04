"use client";

// Typing into a shape or the slide title on the canvas. The renderer draws
// the text, so it wraps exactly as it will be stored and exported; this
// component draws the caret and the selection over it, and takes keys, IME
// composition and the clipboard through a textarea kept at the caret, which
// also places the IME's candidate window there.
import {
  type ClipboardEvent,
  createContext,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
} from "react";

import type { TextLayout } from "@/lib/render/text";
import {
  caretBox,
  lineEdge,
  selectionRects,
  verticalPos,
} from "@/lib/editor/text-caret";
import {
  caretAt,
  collapsed,
  deleteRange,
  endOf,
  ordered,
  plainText,
  type Pos,
  replaceRange,
  selectAll,
  startOf,
  step,
  styleAt,
  type TextSelection,
} from "@/lib/editor/text-edit";
import type { TextDraft, TextFrame } from "@/lib/editor/text-session";

/**
 * The textarea of the text being edited, so the dock can give it focus back
 * after one of its popovers closes.
 */
export const TextFocus =
  createContext<RefObject<HTMLTextAreaElement | null> | null>(null);

/** How a draft changed: typing gathers into one edit, the rest stand alone. */
export type DraftChange = "type" | "edit" | "select";

export type TextKeys = {
  /**
   * The draft as of the last change, which may be newer than the one this
   * render received: two input events can arrive before React renders.
   */
  read: () => TextDraft | null;
  onChange: (next: TextDraft, change: DraftChange) => void;
  onExit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Bold, italic or underline from the keyboard, as the dock toggles them. */
  onToggle: (key: "bold" | "italic" | "underline") => void;
  /** Tab and Shift+Tab at the start of a paragraph change its level. */
  onLevel: (delta: 1 | -1) => void;
};

const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

export function TextEditor({
  draft,
  frame,
  layout,
  selection,
  scale,
  textarea,
  keys,
}: {
  draft: TextDraft;
  frame: TextFrame;
  /** Layout of the text as shown, composition included. */
  layout: TextLayout;
  /** The selection in the shown text. */
  selection: TextSelection;
  /** Canvas px per screen px. */
  scale: number;
  textarea: RefObject<HTMLTextAreaElement | null>;
  keys: TextKeys;
}) {
  // Native listeners read the latest draft through refs: composition events
  // arrive between renders.
  const latest = useRef({ draft, keys, layout });
  useEffect(() => {
    latest.current = { draft, keys, layout };
  });
  const composing = useRef(false);
  const ending = useRef(false);

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.focus({ preventScroll: true });

    const insert = (text: string) => {
      const { keys: on } = latest.current;
      const current = on.read() ?? latest.current.draft;
      const [start, end] = ordered(current.selection);
      const style = current.typing ?? styleAt(current.body, start);
      const { body, caret } = replaceRange(
        current.body,
        start,
        end,
        text,
        style,
        frame.paragraphs
      );
      on.onChange(
        {
          ...current,
          body,
          selection: caretAt(caret),
          composition: null,
          typing: null,
          goal: null,
          dirty: true,
        },
        "type"
      );
    };
    const take = () => {
      const value = element.value;
      element.value = "";
      if (value) insert(value);
    };
    const showComposition = () => {
      const { keys: on } = latest.current;
      const current = on.read() ?? latest.current.draft;
      on.onChange({ ...current, composition: element.value }, "select");
    };

    const onInput = () => {
      // Safari sends the committed text in an input event after
      // compositionend, Chrome before it: the commit below reads the field
      // once, after both.
      if (ending.current) return;
      if (composing.current) showComposition();
      else take();
    };
    const onStart = () => {
      composing.current = true;
    };
    const onUpdate = () => {
      if (composing.current) showComposition();
    };
    const onEnd = () => {
      composing.current = false;
      ending.current = true;
      setTimeout(() => {
        ending.current = false;
        const value = element.value;
        element.value = "";
        if (value) {
          insert(value);
        } else {
          const { keys: on } = latest.current;
          const current = on.read() ?? latest.current.draft;
          on.onChange({ ...current, composition: null }, "select");
        }
      }, 0);
    };
    element.addEventListener("input", onInput);
    element.addEventListener("compositionstart", onStart);
    element.addEventListener("compositionupdate", onUpdate);
    element.addEventListener("compositionend", onEnd);
    return () => {
      element.removeEventListener("input", onInput);
      element.removeEventListener("compositionstart", onStart);
      element.removeEventListener("compositionupdate", onUpdate);
      element.removeEventListener("compositionend", onEnd);
    };
  }, [textarea, frame.paragraphs]);

  // Handlers read the newest draft, not the one this render was given.
  const now = () => keys.read() ?? draft;

  const change = (next: Partial<TextDraft>, kind: DraftChange) =>
    keys.onChange({ ...now(), ...next }, kind);

  const select = (focus: Pos, extend: boolean, goal: number | null = null) =>
    change(
      {
        selection: extend
          ? { anchor: now().selection.anchor, focus }
          : caretAt(focus),
        typing: null,
        goal,
      },
      "select"
    );

  const replace = (from: Pos, to: Pos, text: string) => {
    const draft = now();
    const [start] = ordered({ anchor: from, focus: to });
    const style = draft.typing ?? styleAt(draft.body, start);
    const { body, caret } = replaceRange(
      draft.body,
      from,
      to,
      text,
      style,
      frame.paragraphs
    );
    change(
      {
        body,
        selection: caretAt(caret),
        typing: null,
        goal: null,
        dirty: true,
      },
      "type"
    );
  };

  const remove = (direction: -1 | 1, unit: "char" | "word" | "line") => {
    const draft = now();
    const [start, end] = ordered(draft.selection);
    if (!collapsed(draft.selection)) {
      replace(start, end, "");
      return;
    }
    const target =
      unit === "line"
        ? lineEdge(layout, end, direction < 0 ? "start" : "end")
        : step(draft.body, end, direction, unit);
    if (target.p === end.p && target.o === end.o) return;
    const { body, caret } = deleteRange(draft.body, end, target);
    change(
      {
        body,
        selection: caretAt(caret),
        typing: null,
        goal: null,
        dirty: true,
      },
      "type"
    );
  };

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Keys that drive an IME belong to it until it commits.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const draft = now();
    const mac = isMac();
    const command = mac ? event.metaKey : event.ctrlKey;
    const word = mac ? event.altKey : event.ctrlKey;
    const extend = event.shiftKey;
    const [start, end] = ordered(draft.selection);
    const focus = draft.selection.focus;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight": {
        handled();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        if (!extend && !collapsed(draft.selection) && !word && !command) {
          select(direction < 0 ? start : end, false);
        } else if (mac && command) {
          select(
            lineEdge(layout, focus, direction < 0 ? "start" : "end"),
            extend
          );
        } else {
          select(
            step(draft.body, focus, direction, word ? "word" : "char"),
            extend
          );
        }
        return;
      }
      case "ArrowUp":
      case "ArrowDown": {
        handled();
        const direction = event.key === "ArrowUp" ? -1 : 1;
        if (command) {
          select(direction < 0 ? startOf() : endOf(draft.body), extend);
          return;
        }
        const goal = draft.goal ?? caretBox(layout, focus)?.x ?? 0;
        select(verticalPos(layout, focus, direction, goal), extend, goal);
        return;
      }
      case "Home":
      case "End": {
        handled();
        const edge = event.key === "Home" ? "start" : "end";
        if (event.ctrlKey) {
          select(edge === "start" ? startOf() : endOf(draft.body), extend);
        } else {
          select(lineEdge(layout, focus, edge), extend);
        }
        return;
      }
      case "Backspace":
      case "Delete":
        handled();
        remove(
          event.key === "Backspace" ? -1 : 1,
          mac && event.metaKey ? "line" : word ? "word" : "char"
        );
        return;
      case "Enter":
        handled();
        // Shift+Enter breaks the line inside the paragraph, as in PowerPoint.
        replace(
          start,
          end,
          !frame.paragraphs ? "\n" : event.shiftKey ? "\u000b" : "\n"
        );
        return;
      case "Tab":
        handled();
        if (
          frame.paragraphs &&
          (start.p !== end.p || (collapsed(draft.selection) && start.o === 0))
        ) {
          keys.onLevel(event.shiftKey ? -1 : 1);
        } else if (!event.shiftKey) {
          replace(start, end, "\t");
        }
        return;
      case "Escape":
        handled();
        keys.onExit();
        return;
    }

    if (command) {
      const key = event.key.toLowerCase();
      if (key === "a") {
        handled();
        change({ selection: selectAll(draft.body), goal: null }, "select");
      } else if (key === "z") {
        handled();
        if (event.shiftKey) keys.onRedo();
        else keys.onUndo();
      } else if (key === "y" && !mac) {
        handled();
        keys.onRedo();
      } else if (key === "b" || key === "i" || key === "u") {
        if (!frame.paragraphs) return;
        handled();
        keys.onToggle(
          key === "b" ? "bold" : key === "i" ? "italic" : "underline"
        );
      }
    }
  }

  function onCopy(event: ClipboardEvent<HTMLTextAreaElement>) {
    const draft = now();
    if (collapsed(draft.selection)) return;
    event.preventDefault();
    const [start, end] = ordered(draft.selection);
    event.clipboardData.setData(
      "text/plain",
      plainText(draft.body, start, end)
    );
  }

  function onCut(event: ClipboardEvent<HTMLTextAreaElement>) {
    const draft = now();
    if (collapsed(draft.selection)) return;
    onCopy(event);
    const [start, end] = ordered(draft.selection);
    replace(start, end, "");
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    const [start, end] = ordered(now().selection);
    replace(start, end, text);
  }

  // The caret and selection in the shown text, in the frame's coordinates.
  const [from, to] = ordered(selection);
  const caret = caretBox(layout, selection.focus);
  const rects =
    from.p === to.p && from.o === to.o ? [] : selectionRects(layout, from, to);
  const { box, rotation } = frame;
  const transform = `translate(${box.x} ${box.y})${
    rotation ? ` rotate(${rotation} ${box.w / 2} ${box.h / 2})` : ""
  }`;

  // The textarea sits at the caret, so the IME's candidate window opens there.
  let fieldStyle: React.CSSProperties | undefined;
  if (caret) {
    const r = (rotation * Math.PI) / 180;
    const lx = caret.x - box.w / 2;
    const ly = caret.top - box.h / 2;
    const cx = box.x + box.w / 2 + lx * Math.cos(r) - ly * Math.sin(r);
    const cy = box.y + box.h / 2 + lx * Math.sin(r) + ly * Math.cos(r);
    fieldStyle = {
      left: cx / scale,
      top: cy / scale,
      height: caret.height / scale,
      fontSize: Math.max(8, caret.height / 1.25 / scale),
    };
  }

  return (
    <>
      <svg
        aria-hidden
        viewBox="0 0 1920 1080"
        className="pointer-events-none absolute inset-0 size-full"
      >
        <g transform={transform}>
          {rects.map((rect, i) => (
            <rect
              key={i}
              x={rect.x}
              y={rect.y}
              width={rect.w}
              height={rect.h}
              fill="var(--canvas-selection)"
              fillOpacity={0.25}
            />
          ))}
          {caret && rects.length === 0 && (
            <line
              data-slot="text-caret"
              x1={caret.x}
              x2={caret.x}
              y1={caret.top}
              y2={caret.top + caret.height}
              stroke="var(--canvas-caret)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              className="motion-safe:animate-[caret-blink_1s_steps(1)_infinite]"
            />
          )}
        </g>
      </svg>
      <textarea
        ref={textarea}
        aria-label={draft.target === "title" ? "投影片標題" : "文字"}
        aria-multiline
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        rows={1}
        className="pointer-events-none absolute w-px resize-none overflow-hidden border-0 bg-transparent p-0 leading-none whitespace-pre text-transparent caret-transparent opacity-0 outline-none select-text"
        style={fieldStyle}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
      />
    </>
  );
}
