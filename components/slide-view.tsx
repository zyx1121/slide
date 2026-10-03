import type { Slide } from "@/lib/deck/schema";
import { renderSlideSvg } from "@/lib/render/svg";
import { BACKGROUND_PATH } from "@/lib/render/template";
import { cn } from "@/lib/utils";

/**
 * A slide drawn by the shared renderer, inline. The SVG's text is escaped by
 * the renderer, and every attribute comes from the validated document.
 */
export function SlideView({
  slide,
  number,
  className,
}: {
  slide: Slide;
  number: number;
  className?: string;
}) {
  const svg = renderSlideSvg(slide, {
    slideNumber: number,
    background: BACKGROUND_PATH,
    assetHref: () => null,
  });
  return (
    <div
      data-slot="slide-view"
      role="img"
      aria-label={slide.title || `第 ${number} 頁`}
      className={cn(
        "aspect-video w-full overflow-hidden rounded-lg border border-border bg-white",
        className
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
