"use client";

import { memo, useMemo } from "react";

import type { Layout } from "@/lib/deck/schema";
import { assetUrl } from "@/lib/editor/upload";
import { renderBackdropSvg } from "@/lib/render/svg";
import { cn } from "@/lib/utils";

/**
 * A layout's background and artwork in a layer of its own, under a slide
 * drawn bare. It is rebuilt only when the layout changes, so editing or
 * changing slides never decodes its pictures again (Safari showed that as a
 * white flash).
 */
export const Backdrop = memo(function Backdrop({
  layout,
  assetHref = assetUrl,
  className,
}: {
  layout: Layout;
  assetHref?: (sha256: string) => string | null;
  className?: string;
}) {
  const svg = useMemo(
    () => renderBackdropSvg(layout, { assetHref }),
    [layout, assetHref]
  );
  return (
    <div
      data-slot="slide-backdrop"
      aria-hidden
      className={cn("absolute inset-0 [&>svg]:size-full", className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});
