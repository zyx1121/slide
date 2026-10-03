"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/** How long the window must be visible and focused before Allow works. */
const ARM_MS = 800;

/**
 * The consent page's Allow button. It stays disabled until the window has
 * been visible and focused for a moment without a break, so a consent page
 * loaded behind another window cannot be approved by clicks meant for
 * something else. Without script it stays disabled.
 */
export function ConsentButton() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      setArmed(false);
      if (document.visibilityState === "visible" && document.hasFocus()) {
        timer = setTimeout(() => setArmed(true), ARM_MS);
      }
    };
    const first = setTimeout(check, 0);
    window.addEventListener("focus", check);
    window.addEventListener("blur", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(first);
      clearTimeout(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("blur", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return (
    <Button type="submit" name="decision" value="allow" disabled={!armed}>
      允許
    </Button>
  );
}
