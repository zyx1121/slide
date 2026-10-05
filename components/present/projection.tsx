"use client";
// What the audience sees: the slide shown, as large as the box allows at
// 16:9 on black. Every slide stays drawn, hidden but the one shown, so that
// changing slides shows one already drawn: each frame draws its layout in a
// layer of its own, as the editor does, so it is never decoded again
// (Safari showed that as a white flash).
import { memo, useMemo } from "react";

import type { Blank } from "@/lib/present/control";
import { Backdrop } from "@/components/backdrop";
import type { DeckDocument, Layout, Slide } from "@/lib/deck/schema";
import { assetUrl } from "@/lib/editor/upload";
import { layoutOf } from "@/lib/master/layout";
import { renderSlideSvg } from "@/lib/render/svg";
import { cn } from "@/lib/utils";

export const SlideFrame = memo(function SlideFrame({
  slide,
  number,
  layout,
  hidden = false,
  className,
}: {
  slide: Slide;
  number: number;
  layout: Layout;
  hidden?: boolean;
  className?: string;
}) {
  const svg = useMemo(
    () =>
      renderSlideSvg(slide, {
        slideNumber: number,
        layout,
        bare: true,
        assetHref: assetUrl,
      }),
    [slide, number, layout]
  );
  return (
    <div
      aria-hidden={hidden || undefined}
      {...(hidden
        ? {}
        : { role: "img", "aria-label": slide.title || `第 ${number} 頁` })}
      className={cn(
        "relative aspect-video overflow-hidden bg-white",
        className
      )}
      style={{ visibility: hidden ? "hidden" : undefined }}
    >
      <Backdrop layout={layout} />
      <div
        data-slot="slide-view"
        aria-hidden
        className="absolute inset-0 [&>svg]:size-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
});

/** The largest 16:9 box that fits the container (a size container). */
export const FIT = "aspect-video w-[min(100cqw,calc(100cqh*16/9))]";

export function Projection({
  document,
  index,
  blank = null,
  className,
}: {
  document: DeckDocument;
  index: number;
  blank?: Blank;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "[container-type:size] flex size-full items-center justify-center overflow-hidden bg-black",
        className
      )}
    >
      <div className={cn("relative", FIT)}>
        {document.slides.map((slide, i) => (
          <SlideFrame
            key={slide.id}
            slide={slide}
            number={i + 1}
            layout={layoutOf(document, slide)}
            hidden={i !== index || blank !== null}
            className="absolute inset-0"
          />
        ))}
        {blank && (
          <div
            data-blank={blank}
            className={cn(
              "absolute inset-0",
              blank === "black" ? "bg-black" : "bg-white"
            )}
          />
        )}
      </div>
    </div>
  );
}
