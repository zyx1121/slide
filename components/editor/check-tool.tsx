"use client";

// The dock's rule check: how many problems the deck has, and a list that
// takes the member to each one. The rules are lib/rules/check.ts, the same
// ones the MCP tool check_deck runs.
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useMemo, useState } from "react";

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
import type { DeckDocument } from "@/lib/deck/schema";
import { checkDeck, describeShape, type Violation } from "@/lib/rules/check";

export function CheckTool({
  document,
  onShow,
}: {
  document: DeckDocument;
  /** Shows a problem: its slide, with its shape selected. */
  onShow: (violation: Violation) => void;
}) {
  const [open, setOpen] = useState(false);
  const violations = useMemo(() => checkDeck(document), [document]);
  const count = violations.length;
  const label = count === 0 ? "檢查：沒有問題" : `檢查：${count} 個問題`;
  const name = (violation: Violation) => {
    if (!violation.shape) return "標題";
    const slide = document.slides[violation.slide - 1];
    const shape = slide?.shapes.find((item) => item.id === violation.shape);
    return shape ? describeShape(shape) : violation.shape;
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  className="relative min-w-8 gap-1 px-2 tabular-nums"
                  aria-label={label}
                />
              }
            />
          }
        >
          {count === 0 ? <CircleCheckIcon /> : <CircleAlertIcon />}
          {count > 0 && <span className="text-xs">{count}</span>}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        sideOffset={12}
        data-surface="tinted"
        className="w-96"
      >
        {count === 0 ? (
          <p className="text-xs text-muted-foreground">
            依投影片規則，沒有發現問題。
          </p>
        ) : (
          <ol className="flex max-h-[50dvh] flex-col gap-1 overflow-y-auto">
            {violations.map((violation, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    onShow(violation);
                    setOpen(false);
                  }}
                  className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left outline-offset-2 hover:bg-foreground/5 focus-visible:outline-2"
                >
                  <span className="text-xs text-muted-foreground tabular-nums">
                    第 {violation.slide} 頁 · {name(violation)}
                  </span>
                  <span className="text-xs">{violation.message}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  );
}
