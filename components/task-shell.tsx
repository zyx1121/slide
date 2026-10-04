"use client";

import type { ReactNode } from "react";
import { BottomCorners, LegalLinks, TopCorners } from "@/components/corners";
import { cn } from "@/lib/utils";

/** The mark's link, name and tip for a home. */
export function markTo(home: string, chinese = true) {
  return home === "/"
    ? {
        home,
        label: chinese ? "所有簡報" : "All decks",
        markTip: chinese ? "所有簡報" : "All decks",
      }
    : { home };
}

export function TaskShell({
  title,
  description,
  actions,
  children,
  wide = false,
  lang = "en",
  home = "/",
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  lang?: "en" | "zh-TW";
  /**
   * Where the mark goes: Slide's home by default; a page for visitors
   * without an account (a public deck) sends them to www.zyx.tw instead.
   */
  home?: string;
}) {
  const chinese = lang === "zh-TW";
  return (
    <>
      <a
        href="#task"
        className="fixed top-5 left-20 z-[60] -translate-y-24 rounded-md bg-background px-3 py-2 text-sm focus:translate-y-0"
      >
        {chinese ? "跳至主要內容" : "Skip to content"}
      </a>
      <TopCorners
        fade
        {...markTo(home, chinese)}
        nav={
          actions && (
            <nav
              aria-label={chinese ? "任務操作" : "Task actions"}
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
        className={cn(
          "mx-auto min-h-svh w-full px-5 pt-30 pb-25 outline-none",
          wide ? "max-w-6xl" : "max-w-xl lg:max-w-3xl 2xl:max-w-5xl"
        )}
      >
        <div className="mb-10">
          <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
          {description && (
            <p className="mt-3 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {children}
      </main>
      <BottomCorners
        fade
        links={
          <LegalLinks
            labels={chinese ? { privacy: "隱私", terms: "條款" } : undefined}
            tips={
              chinese
                ? {
                    privacy: "zyx.tw 各站的資料與紀錄方式",
                    terms: "zyx.tw 各站的使用條款",
                  }
                : undefined
            }
          />
        }
      />
    </>
  );
}
