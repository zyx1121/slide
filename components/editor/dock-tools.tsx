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
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  PaintBucketIcon,
  PenLineIcon,
  SplineIcon,
  TextAlignCenterIcon,
  TextAlignEndIcon,
  TextAlignStartIcon,
  UnderlineIcon,
} from "lucide-react";
import {
  type ComponentType,
  type ReactNode,
  useContext,
  useState,
} from "react";

import { TextFocus } from "@/components/editor/text-editor";

import { DockPopover, Tool } from "@/components/editor/dock-parts";
import { Button } from "@/components/ui/button";
import type {
  Align,
  Anchor,
  ArrowHead,
  Bullet,
  Dash,
  Route,
  SelectionStyle,
  Shared,
  StyleChange,
} from "@/lib/editor/style";
import { PALETTE } from "@/lib/editor/palette";
import { cn } from "@/lib/utils";

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
const BULLETS: { value: Bullet; name: string; icon: ComponentType }[] = [
  { value: "none", name: "無", icon: TextAlignStartIcon },
  { value: "bullet", name: "項目符號", icon: ListIcon },
  { value: "number", name: "編號", icon: ListOrderedIcon },
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
function ChoicePopover({
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
  // While a text is edited, closing hands the keys back to it.
  const text = useContext(TextFocus);
  return (
    <DockPopover
      tip={tip}
      label={label}
      trigger={trigger}
      button={{ size: "default", className: "relative min-w-8 px-2" }}
      panel={wide ? "w-80" : "w-auto"}
      open={open}
      onOpenChange={setOpen}
      finalFocus={() => text?.current ?? true}
    >
      {children(() => setOpen(false))}
    </DockPopover>
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
    <ChoicePopover
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
    </ChoicePopover>
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
    <ChoicePopover
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
    </ChoicePopover>
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
  const bullet = BULLETS.find((option) => option.value === text.bullet);
  const BulletIcon = bullet && bullet.value !== "none" ? bullet.icon : ListIcon;
  return (
    <>
      <ChoicePopover
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
      </ChoicePopover>
      <Tool
        tip="粗體"
        icon={BoldIcon}
        pressed={text.bold}
        onClick={() => toggle("bold", text.bold)}
      />
      <Tool
        tip="斜體"
        icon={ItalicIcon}
        pressed={text.italic}
        onClick={() => toggle("italic", text.italic)}
      />
      <Tool
        tip="底線"
        icon={UnderlineIcon}
        pressed={text.underline}
        onClick={() => toggle("underline", text.underline)}
      />
      <ChoicePopover
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
      </ChoicePopover>
      <ChoicePopover
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
      </ChoicePopover>
      <ChoicePopover
        tip="項目符號"
        label={`項目符號：${bullet?.name ?? "混合"}`}
        trigger={<BulletIcon />}
      >
        {(close) => (
          <Choices
            options={BULLETS}
            value={text.bullet}
            onPick={(value) => {
              onChange({ kind: "bullet", bullet: value });
              close();
            }}
            render={(option) => {
              const Icon = BULLETS.find((b) => b.value === option.value)!.icon;
              return <Icon />;
            }}
          />
        )}
      </ChoicePopover>
      <Tool
        tip="減少縮排"
        icon={IndentDecreaseIcon}
        onClick={() => onChange({ kind: "level", delta: -1 })}
      />
      <Tool
        tip="增加縮排"
        icon={IndentIncreaseIcon}
        onClick={() => onChange({ kind: "level", delta: 1 })}
      />
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
      <ChoicePopover
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
      </ChoicePopover>
      {(["start", "end"] as const).map((end) => {
        const head = end === "start" ? line.start : line.end;
        const tip = end === "start" ? "起點箭頭" : "終點箭頭";
        return (
          <ChoicePopover
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
          </ChoicePopover>
        );
      })}
    </>
  );
}
