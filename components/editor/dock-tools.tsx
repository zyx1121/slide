"use client";

// The dock's tools for what is selected: fill and outline for shapes, type
// for text, route and arrowheads for connectors. Each opens its choices in a
// popover above the dock, over the slide, on the tinted surface.
import {
  AlignVerticalJustifyCenterIcon,
  AlignVerticalJustifyEndIcon,
  AlignVerticalJustifyStartIcon,
  BaselineIcon,
  BoldIcon,
  CornerDownRightIcon,
  ItalicIcon,
  MinusIcon,
  PaintBucketIcon,
  PenLineIcon,
  SplineIcon,
  TextAlignCenterIcon,
  TextAlignEndIcon,
  TextAlignStartIcon,
  UnderlineIcon,
} from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";

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
import type {
  Align,
  Anchor,
  ArrowHead,
  Dash,
  Route,
  SelectionStyle,
  Shared,
  StyleChange,
} from "@/lib/editor/style";
import { cn } from "@/lib/utils";

/** The colors on offer, from the WinLab template's blues and Office's set. */
export const PALETTE = [
  { name: "黑", value: "#000000" },
  { name: "深灰", value: "#595959" },
  { name: "灰", value: "#a6a6a6" },
  { name: "淺灰", value: "#f2f2f2" },
  { name: "白", value: "#ffffff" },
  { name: "WinLab 藍", value: "#3297fc" },
  { name: "深藍", value: "#4f81bd" },
  { name: "淺藍", value: "#e8f1fe" },
  { name: "紅", value: "#c00000" },
  { name: "淺紅", value: "#fbe5d6" },
  { name: "橘", value: "#ed7d31" },
  { name: "黃", value: "#ffc000" },
  { name: "淺黃", value: "#fff2cc" },
  { name: "綠", value: "#70ad47" },
  { name: "淺綠", value: "#e2f0d9" },
  { name: "紫", value: "#7030a0" },
];

/** Text sizes in points, as PowerPoint lists them; a point is 2 canvas px. */
const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72];
/** Line widths in canvas px; the labels show points. */
const WIDTHS = [1, 2, 3, 4, 6, 8];
const DASHES: { value: Dash; name: string; pattern?: string }[] = [
  { value: "solid", name: "實線" },
  { value: "dash", name: "虛線", pattern: "4 3" },
  { value: "dot", name: "點線", pattern: "1 2" },
  { value: "dashDot", name: "點虛線", pattern: "4 2 1 2" },
];
const ROUTES: { value: Route; name: string; icon: ComponentType }[] = [
  { value: "straight", name: "直線", icon: MinusIcon },
  { value: "elbow", name: "折線", icon: CornerDownRightIcon },
  { value: "curved", name: "曲線", icon: SplineIcon },
];
const HEADS: { value: ArrowHead; name: string }[] = [
  { value: "none", name: "無" },
  { value: "triangle", name: "三角形" },
  { value: "arrow", name: "開放箭頭" },
  { value: "stealth", name: "燕尾" },
  { value: "oval", name: "圓形" },
  { value: "diamond", name: "菱形" },
];
const ALIGNS: { value: Align; name: string; icon: ComponentType }[] = [
  { value: "left", name: "靠左", icon: TextAlignStartIcon },
  { value: "center", name: "置中", icon: TextAlignCenterIcon },
  { value: "right", name: "靠右", icon: TextAlignEndIcon },
];
const ANCHORS: { value: Anchor; name: string; icon: ComponentType }[] = [
  { value: "top", name: "靠上", icon: AlignVerticalJustifyStartIcon },
  { value: "middle", name: "垂直置中", icon: AlignVerticalJustifyCenterIcon },
  { value: "bottom", name: "靠下", icon: AlignVerticalJustifyEndIcon },
];

type Change = (change: StyleChange) => void;

const colorName = (value: string | null) =>
  value === null
    ? "無"
    : (PALETTE.find((color) => color.value === value)?.name ?? value);

/** A dock button that opens its choices above the dock. */
function DockPopover({
  tip,
  label,
  trigger,
  children,
  wide = false,
}: {
  tip: string;
  /** What the button says to screen readers, with its current value. */
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  className="relative min-w-8 px-2"
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
        className={wide ? "w-80" : "w-auto"}
      >
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

/** An icon with a bar under it in the color it stands for. */
function ColorIcon({
  icon: Icon,
  color,
}: {
  icon: ComponentType;
  color: Shared<string | null> | undefined;
}) {
  const solid = color && color !== "mixed" ? color : null;
  return (
    <span className="relative flex flex-col items-center">
      <Icon />
      <span
        aria-hidden
        className={cn(
          "mt-0.5 h-1 w-4 rounded-full border border-foreground/20",
          !solid && "bg-transparent"
        )}
        style={solid ? { backgroundColor: solid } : undefined}
      />
    </span>
  );
}

function Swatches({
  value,
  onPick,
}: {
  value: Shared<string | null> | undefined;
  onPick: (color: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {PALETTE.map((color) => (
        <button
          key={color.value}
          type="button"
          aria-label={color.name}
          aria-pressed={value === color.value}
          title={color.name}
          onClick={() => onPick(color.value)}
          className={cn(
            "size-6 rounded-md border border-foreground/20 outline-offset-2 focus-visible:outline-2",
            value === color.value &&
              "ring-2 ring-foreground ring-offset-2 ring-offset-popover"
          )}
          style={{ backgroundColor: color.value }}
        />
      ))}
    </div>
  );
}

/** A row of choices, one of which is current. */
function Choices<T extends string | number>({
  options,
  value,
  onPick,
  render,
}: {
  options: { value: T; name: string }[];
  value: Shared<T> | null | undefined;
  onPick: (value: T) => void;
  render: (option: { value: T; name: string }) => ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => (
        <Button
          key={String(option.value)}
          variant={value === option.value ? "secondary" : "ghost"}
          aria-pressed={value === option.value}
          aria-label={option.name}
          title={option.name}
          onClick={() => onPick(option.value)}
          className="min-w-8 px-2"
        >
          {render(option)}
        </Button>
      ))}
    </div>
  );
}

function DashGlyph({ pattern }: { pattern?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <line
        x1="2"
        y1="12"
        x2="22"
        y2="12"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={pattern}
      />
    </svg>
  );
}

/** A connector end: the line runs in from the left to `head` at the right. */
function HeadGlyph({
  head,
  flip = false,
}: {
  head: ArrowHead;
  flip?: boolean;
}) {
  const shape = {
    none: null,
    triangle: <path d="M15 7 L22 12 L15 17 Z" fill="currentColor" />,
    arrow: <path d="M15 7 L22 12 L15 17" fill="none" />,
    stealth: <path d="M14 7 L22 12 L14 17 L17 12 Z" fill="currentColor" />,
    oval: <circle cx="18.5" cy="12" r="3.5" fill="currentColor" />,
    diamond: <path d="M14 12 L18 8 L22 12 L18 16 Z" fill="currentColor" />,
  }[head];
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("size-4", flip && "-scale-x-100")}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <line x1="2" y1="12" x2={head === "none" ? 22 : 16} y2="12" />
      {shape}
    </svg>
  );
}

const pt = (px: number) => px / 2;

/** Fill, for shapes and text boxes. */
export function FillTool({
  value,
  onChange,
}: {
  value: Shared<string | null>;
  onChange: Change;
}) {
  return (
    <DockPopover
      tip="填色"
      label={`填色：${value === "mixed" ? "混合" : colorName(value)}`}
      trigger={<ColorIcon icon={PaintBucketIcon} color={value} />}
    >
      {(close) => (
        <div className="flex flex-col gap-3">
          <Swatches
            value={value}
            onPick={(color) => {
              onChange({ kind: "fill", color });
              close();
            }}
          />
          <Button
            variant={value === null ? "secondary" : "ghost"}
            onClick={() => {
              onChange({ kind: "fill", color: null });
              close();
            }}
          >
            無填色
          </Button>
        </div>
      )}
    </DockPopover>
  );
}

/** Outline color, width and dash; a connector's line. */
export function StrokeTool({
  stroke,
  line,
  onChange,
}: {
  stroke: NonNullable<SelectionStyle["stroke"]>;
  /** Whether every pick is a connector, whose line this is. */
  line: boolean;
  onChange: Change;
}) {
  const name = line ? "線條" : "框線";
  return (
    <DockPopover
      tip={name}
      label={`${name}：${stroke.color === "mixed" ? "混合" : colorName(stroke.color)}`}
      trigger={<ColorIcon icon={PenLineIcon} color={stroke.color} />}
      wide
    >
      {() => (
        <div className="flex flex-col gap-3">
          <Swatches
            value={stroke.color}
            onPick={(color) => onChange({ kind: "stroke", color })}
          />
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">粗細（pt）</p>
            <Choices
              options={WIDTHS.map((width) => ({
                value: width,
                name: `${pt(width)} pt`,
              }))}
              value={stroke.width}
              onPick={(width) => onChange({ kind: "stroke", width })}
              render={(option) => (
                <span className="text-xs tabular-nums">{pt(option.value)}</span>
              )}
            />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">樣式</p>
            <Choices
              options={DASHES}
              value={stroke.dash}
              onPick={(dash) => onChange({ kind: "stroke", dash })}
              render={(option) => (
                <DashGlyph
                  pattern={
                    DASHES.find((dash) => dash.value === option.value)?.pattern
                  }
                />
              )}
            />
          </div>
          {stroke.optional && (
            <Button
              variant={stroke.color === null ? "secondary" : "ghost"}
              onClick={() => onChange({ kind: "noStroke" })}
            >
              無框線
            </Button>
          )}
        </div>
      )}
    </DockPopover>
  );
}

/** Size, weight, slant, underline, color and alignment of whole texts. */
export function TextTools({
  text,
  onChange,
}: {
  text: NonNullable<SelectionStyle["text"]>;
  onChange: Change;
}) {
  const toggle = (
    key: "bold" | "italic" | "underline",
    value: Shared<boolean>
  ) => onChange({ kind: "text", [key]: value !== true });
  const align =
    ALIGNS.find((option) => option.value === text.align) ?? ALIGNS[0];
  const AlignIcon = align.icon;
  return (
    <>
      <DockPopover
        tip="字級"
        label={`字級：${text.size === "mixed" ? "混合" : `${pt(text.size)} pt`}`}
        trigger={
          <span className="tabular-nums">
            {text.size === "mixed" ? "–" : pt(text.size)}
          </span>
        }
        wide
      >
        {(close) => (
          <div className="grid grid-cols-6 gap-1">
            {SIZES.map((size) => (
              <Button
                key={size}
                variant={text.size === size * 2 ? "secondary" : "ghost"}
                aria-pressed={text.size === size * 2}
                className="px-0 tabular-nums"
                onClick={() => {
                  onChange({ kind: "text", size: size * 2 });
                  close();
                }}
              >
                {size}
              </Button>
            ))}
          </div>
        )}
      </DockPopover>
      <Toggle
        tip="粗體"
        icon={BoldIcon}
        on={text.bold}
        onClick={() => toggle("bold", text.bold)}
      />
      <Toggle
        tip="斜體"
        icon={ItalicIcon}
        on={text.italic}
        onClick={() => toggle("italic", text.italic)}
      />
      <Toggle
        tip="底線"
        icon={UnderlineIcon}
        on={text.underline}
        onClick={() => toggle("underline", text.underline)}
      />
      <DockPopover
        tip="文字顏色"
        label={`文字顏色：${text.color === "mixed" ? "混合" : colorName(text.color)}`}
        trigger={<ColorIcon icon={BaselineIcon} color={text.color} />}
      >
        {(close) => (
          <Swatches
            value={text.color}
            onPick={(color) => {
              onChange({ kind: "text", color });
              close();
            }}
          />
        )}
      </DockPopover>
      <DockPopover
        tip="對齊"
        label={`對齊：${align.name}`}
        trigger={<AlignIcon />}
      >
        {() => (
          <div className="flex flex-col gap-2">
            <Choices
              options={ALIGNS}
              value={text.align}
              onPick={(value) => onChange({ kind: "align", align: value })}
              render={(option) => {
                const Icon = ALIGNS.find((a) => a.value === option.value)!.icon;
                return <Icon />;
              }}
            />
            <Choices
              options={ANCHORS}
              value={text.anchor}
              onPick={(value) => onChange({ kind: "anchor", anchor: value })}
              render={(option) => {
                const Icon = ANCHORS.find(
                  (a) => a.value === option.value
                )!.icon;
                return <Icon />;
              }}
            />
          </div>
        )}
      </DockPopover>
    </>
  );
}

/** A connector's route and arrowheads. */
export function LineTools({
  line,
  onChange,
}: {
  line: NonNullable<SelectionStyle["line"]>;
  onChange: Change;
}) {
  const route = ROUTES.find((option) => option.value === line.route);
  const RouteIcon = route?.icon ?? ROUTES[0].icon;
  const headName = (head: Shared<ArrowHead>) =>
    head === "mixed"
      ? "混合"
      : HEADS.find((option) => option.value === head)!.name;
  return (
    <>
      <DockPopover
        tip="線型"
        label={`線型：${route?.name ?? "混合"}`}
        trigger={<RouteIcon />}
      >
        {(close) => (
          <Choices
            options={ROUTES}
            value={line.route}
            onPick={(value) => {
              onChange({ kind: "route", route: value });
              close();
            }}
            render={(option) => {
              const Icon = ROUTES.find((r) => r.value === option.value)!.icon;
              return <Icon />;
            }}
          />
        )}
      </DockPopover>
      {(["start", "end"] as const).map((end) => {
        const head = end === "start" ? line.start : line.end;
        const tip = end === "start" ? "起點箭頭" : "終點箭頭";
        return (
          <DockPopover
            key={end}
            tip={tip}
            label={`${tip}：${headName(head)}`}
            trigger={
              <HeadGlyph
                head={head === "mixed" ? "none" : head}
                flip={end === "start"}
              />
            }
          >
            {(close) => (
              <Choices
                options={HEADS}
                value={head}
                onPick={(value) => {
                  onChange({ kind: "arrow", end, head: value });
                  close();
                }}
                render={(option) => (
                  <HeadGlyph head={option.value} flip={end === "start"} />
                )}
              />
            )}
          </DockPopover>
        );
      })}
    </>
  );
}

function Toggle({
  tip,
  icon: Icon,
  on,
  onClick,
}: {
  tip: string;
  icon: ComponentType;
  on: Shared<boolean>;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={on === true ? "secondary" : "ghost"}
            size="icon"
            aria-label={tip}
            aria-pressed={on === "mixed" ? "mixed" : on}
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
