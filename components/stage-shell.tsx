"use client";

import type { ReactNode } from "react";
import { TopCorners } from "@/components/corners";

/**
 * The shell for a page whose working surface fills the viewport, as Plump's
 * canvas does: the zyx mark and the page's actions in the top corners, over
 * the surface, which scrolls under a fade. The owner keeps the bottom
 * corners off this page. Column pages use TaskShell instead.
 */
export function StageShell({
  title,
  actions,
  children,
}: {
  /** The page's heading, for screen readers; the surface shows itself. */
  title: string;
  actions?: ReactNode;
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
      <TopCorners
        fade
        nav={
          actions && (
            <nav
              aria-label="任務操作"
              className="flex max-w-[calc(100vw-6.25rem)] items-center gap-4"
            >
              {actions}
            </nav>
          )
        }
      />
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
