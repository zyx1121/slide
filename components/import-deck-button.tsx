"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { CornerTip, cornerLink } from "@/components/corners";
import { IMPORT_MAX_BYTES } from "@/lib/deck/limits";

const ERRORS: Record<string, string> = {
  "too-large": "檔案超過 100 MB，沒有匯入。",
  "not-pptx": "這不是 .pptx 檔。",
  malformed: "這個 .pptx 讀不出來，可能已損壞。",
};

/**
 * The home page's import action: a .pptx from the member's computer becomes
 * a deck, opened right away with a report of what was left out.
 */
export function ImportDeckButton() {
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, onError] = useState<string | null>(null);

  const upload = async (file: File) => {
    onError(null);
    if (file.size > IMPORT_MAX_BYTES) {
      onError(ERRORS["too-large"]);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/decks/import", {
        method: "POST",
        body: file,
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "x-file-name": encodeURIComponent(file.name),
        },
      });
      const body = (await response.json().catch(() => ({}))) as {
        id?: string;
        report?: { skipped?: Record<string, number> };
        error?: string;
      };
      if (response.ok && body.id) {
        const skipped = JSON.stringify(body.report?.skipped ?? {});
        router.push(
          `/decks/${body.id}?imported=${encodeURIComponent(skipped)}`
        );
        return;
      }
      onError(ERRORS[body.error ?? ""] ?? "匯入失敗，請再試一次。");
    } catch {
      onError("匯入失敗，請檢查網路。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={picker}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      <CornerTip tip="從 PowerPoint 檔建立簡報">
        <button
          type="button"
          disabled={busy}
          onClick={() => picker.current?.click()}
          className={cornerLink}
        >
          {busy ? "匯入中…" : "匯入"}
        </button>
      </CornerTip>
      {error && (
        <p
          role="alert"
          className="fixed top-14 right-5 max-w-72 text-right text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </>
  );
}
