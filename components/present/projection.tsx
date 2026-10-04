"use client";
// What the audience sees: the slide shown, as large as the box allows at
// 16:9 on black. Every slide stays drawn, hidden but the one shown, so that
// changing slides shows one already drawn: the template background lives on
// each frame, not in the SVG, as in the editor, so it is never decoded
// again (Safari showed that as a white flash).
import { memo, useMemo } from "react";

import type { Blank } from "@/lib/present/control";
import type { DeckDocument, Slide } from "@/lib/deck/schema";
import { assetUrl } from "@/lib/editor/upload";
import { renderSlideSvg } from "@/lib/render/svg";
import { TEMPLATES, templateOf, type TemplateId } from "@/lib/render/template";
import { cn } from "@/lib/utils";

export const SlideFrame = memo(function SlideFrame({
  slide,
  number,
  template,
  hidden = false,
  className,
}: {
  slide: Slide;
  number: number;
  template: TemplateId;
  hidden?: boolean;
  className?: string;
}) {
  const svg = useMemo(
    () =>
      renderSlideSvg(slide, {
        slideNumber: number,
        template,
        background: null,
        bare: true,
        assetHref: assetUrl,
      }),
    [slide, number, template]
  );
  const background = TEMPLATES[template].background;
  return (
    <div
      data-slot="slide-view"
      aria-hidden={hidden || undefined}
      {...(hidden
        ? {}
        : { role: "img", "aria-label": slide.title || `第 ${number} 頁` })}
      className={cn(
        "aspect-video overflow-hidden bg-white bg-size-[100%_100%]",
        className
      )}
      style={{
        backgroundImage: background ? `url(${background})` : undefined,
        visibility: hidden ? "hidden" : undefined,
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
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
  const template = templateOf(document).id;
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
            template={template}
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
