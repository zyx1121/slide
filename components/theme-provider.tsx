"use client";

import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import { useEffect, type ReactNode } from "react";

/**
 * Dark first, light one key away (ui.zyx.tw DESIGN.md): every page starts
 * dark whatever the OS prefers, and `d` toggles the theme outside text input.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <ThemeHotkey />
      {children}
    </NextThemes>
  );
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "d" ||
        event.repeat ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox]"
        )
      ) {
        return;
      }
      setTheme(resolvedTheme === "dark" ? "light" : "dark");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resolvedTheme, setTheme]);
  return null;
}
