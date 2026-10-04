"use client";
// What every dock button is made of: a tooltip over a ghost icon button, and
// for a tool with choices, a tinted panel that opens above the dock.
import type { ComponentProps, ComponentType, ReactNode, Ref } from "react";

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

/** An icon button with its name as a tooltip. */
export function Tool({
  tip,
  label = tip,
  icon: Icon,
  pressed,
  disabled,
  onClick,
  type = "button",
  ref,
  className,
}: {
  tip: string;
  /** What screen readers hear, when it says more than the tooltip. */
  label?: string;
  icon: ComponentType;
  /** For a tool that stays on: whether it is, or "mixed" across a selection. */
  pressed?: boolean | "mixed";
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  ref?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            type={type}
            variant={pressed === true ? "secondary" : "ghost"}
            size="icon"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            className={className}
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

/** A dock button that opens its panel above the dock. */
export function DockPopover({
  tip,
  label = tip,
  trigger,
  button,
  panel,
  open,
  onOpenChange,
  finalFocus,
  children,
}: {
  tip: string;
  /** What screen readers hear, when it says more than the tooltip. */
  label?: string;
  /** What the button shows: an icon, or a value. */
  trigger: ReactNode;
  /** The button's look, an icon button by default. */
  button?: Pick<
    ComponentProps<typeof Button>,
    "variant" | "size" | "className"
  >;
  /** The panel's classes: its width and layout. */
  panel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  finalFocus?: ComponentProps<typeof PopoverContent>["finalFocus"];
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  {...button}
                  aria-label={label}
                />
              }
            />
          }
        >
          {trigger}
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        sideOffset={12}
        data-surface="tinted"
        className={panel}
        finalFocus={finalFocus}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
