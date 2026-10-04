"use client";

import { PencilIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import {
  type ComponentType,
  type Ref,
  type RefObject,
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  type ActionResult,
  deleteDeckAction,
  renameDeckAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DECK_TITLE_MAX } from "@/lib/deck/limits";

type Props = {
  id: string;
  title: string;
  slideCount: number;
  /** When the deck last changed: ISO for the machine, text for people. */
  updated: { iso: string; text: string };
};

/**
 * A deck card's text: the title, which links the whole card, the size and
 * last edit, and the rename and delete actions. Both act in place, without a
 * dialog: the theme's frosted overlays turn unreadable over white slides.
 */
export function DeckRow({ id, title, slideCount, updated }: Props) {
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const renameButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  // The button that opened a form gets focus back once the view returns,
  // which after a save waits for the refreshed list.
  const restore = useRef<RefObject<HTMLButtonElement | null>>(null);
  useEffect(() => {
    if (mode !== "view" || !restore.current) return;
    restore.current.current?.focus();
    restore.current = null;
  }, [mode]);
  const back = (button: RefObject<HTMLButtonElement | null>) => {
    restore.current = button;
    setMode("view");
  };

  if (mode === "rename") {
    return (
      <RenameForm id={id} title={title} onClose={() => back(renameButton)} />
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The link's ::after covers the card, so the thumbnail opens it too. */}
        <Link
          href={`/decks/${id}`}
          className="truncate outline-none after:absolute after:inset-0 after:rounded-lg after:outline-offset-4 hover:underline focus-visible:after:outline-2"
        >
          {title}
        </Link>
        {mode === "delete" ? (
          <DeleteForm
            id={id}
            title={title}
            onCancel={() => back(deleteButton)}
          />
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">
            {slideCount} 頁 · <time dateTime={updated.iso}>{updated.text}</time>
          </span>
        )}
      </div>
      {mode === "view" && (
        <div className="relative z-10 -my-1 -mr-2 flex">
          <IconAction
            ref={renameButton}
            tip="重新命名"
            label={`重新命名「${title}」`}
            icon={PencilIcon}
            onClick={() => setMode("rename")}
          />
          <IconAction
            ref={deleteButton}
            tip="刪除"
            label={`刪除「${title}」`}
            icon={Trash2Icon}
            onClick={() => setMode("delete")}
          />
        </div>
      )}
    </div>
  );
}

function IconAction({
  ref,
  tip,
  label,
  icon: Icon,
  onClick,
}: {
  ref: Ref<HTMLButtonElement>;
  tip: string;
  label: string;
  icon: ComponentType;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            variant="ghost"
            size="icon"
            aria-label={label}
            className="text-muted-foreground"
            onClick={onClick}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

/** Runs a deck action from a form and calls `onDone` once it succeeds. */
function useDeckAction(
  run: (form: FormData) => Promise<ActionResult>,
  onDone?: () => void
) {
  return useActionState(async (_: ActionResult | null, form: FormData) => {
    const result = await run(form);
    // Updates after an await leave the action's transition; a new one keeps
    // the form up until the refreshed list arrives, so the old title never
    // flashes.
    if (result.ok && onDone) startTransition(onDone);
    return result;
  }, null);
}

function RenameForm({
  id,
  title,
  onClose,
}: {
  id: string;
  title: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useDeckAction(renameDeckAction, onClose);
  // Controlled, so the field keeps what was typed when a save is refused
  // (React resets uncontrolled fields after every form action).
  const [value, setValue] = useState(title);
  const errorId = useId();
  const error = state && !state.ok ? state.error : null;

  return (
    <form action={action} className="relative z-10 flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-2">
        <Input
          name="title"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={DECK_TITLE_MAX}
          autoComplete="off"
          autoFocus
          aria-label="簡報名稱"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1"
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onClose();
          }}
        />
        <Button type="submit" disabled={pending}>
          儲存
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          取消
        </Button>
      </div>
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function DeleteForm({
  id,
  title,
  onCancel,
}: {
  id: string;
  title: string;
  onCancel: () => void;
}) {
  // On success the list refreshes without this deck, which unmounts the
  // form; focus moves to the page's main region instead of being lost.
  const [state, action, pending] = useDeckAction(deleteDeckAction, () =>
    document.getElementById("task")?.focus()
  );
  const messageId = useId();
  const error = state && !state.ok ? state.error : null;

  return (
    <form
      action={action}
      className="relative z-10 mt-1 flex flex-col gap-2"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onCancel();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <p id={messageId} className="text-xs text-muted-foreground">
        簡報會移到下方的「最近刪除」，隨時可以還原。
      </p>
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="destructive"
          disabled={pending}
          aria-label={`刪除「${title}」`}
          aria-describedby={messageId}
        >
          刪除
        </Button>
        <Button
          type="button"
          variant="ghost"
          autoFocus
          aria-describedby={messageId}
          onClick={onCancel}
        >
          取消
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
