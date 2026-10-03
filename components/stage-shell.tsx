"use client";

import type { ReactNode } from "react";
import { TopCorners } from "@/components/corners";

/**
 * The shell for a page whose working surface fills the viewport, as Plump's
 * canvas does: the zyx mark over the surface, which scrolls under it. Column
 * pages use TaskShell instead.
 */
export function StageShell({
  title,
  children,
}: {
  /** The page's heading, for screen readers; the surface shows itself. */
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <a
        href="#task"
        className="fixed top-5 left-20 z-[60] -translate-y-24 rounded-md bg-background px-3 py-2 text-sm focus:translate-y-0"
      >
        跳至主要內容
      </a>
      {/* Only the mark: the owner keeps the other corners and the edge fade
          off this page. The mark's ink follows what scrolls under it
          (--stage-logo-ink, set by the editor), as on the Made pages. */}
      <TopCorners className="text-[color:var(--stage-logo-ink,var(--foreground))] motion-safe:transition-colors" />
      <main
        id="task"
        tabIndex={-1}
        data-stage
        className="fixed inset-0 overflow-hidden outline-none"
      >
        <h1 className="sr-only">{title}</h1>
        {children}
      </main>
    </>
  );
}
