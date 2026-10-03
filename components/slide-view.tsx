import type { Slide } from "@/lib/deck/schema";
import { assetUrl } from "@/lib/editor/upload";
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
  decorative = false,
  assetHref = assetUrl,
  className,
}: {
  slide: Slide;
  number: number;
  /** Hidden from screen readers, as a thumbnail inside a labelled link. */
  decorative?: boolean;
  /** Where pictures load from: the member's assets by default. */
  assetHref?: (sha256: string) => string | null;
  className?: string;
}) {
  const svg = renderSlideSvg(slide, {
    slideNumber: number,
    background: BACKGROUND_PATH,
    assetHref,
  });
  return (
    <div
      data-slot="slide-view"
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": slide.title || `第 ${number} 頁` })}
      className={cn(
        "aspect-video w-full overflow-hidden rounded-lg border border-border bg-white",
        className
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
