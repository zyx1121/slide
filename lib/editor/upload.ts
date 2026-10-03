// The browser side of image uploads: sends a file to POST /api/assets and
// says, in the editor's words, why one was not taken.
import { ASSET_MAX_BYTES } from "../deck/limits";

export type Uploaded = { sha256: string; width: number; height: number };

/** Where the browser loads an asset from. */
export const assetUrl = (sha256: string) => `/api/assets/${sha256}`;

const MESSAGES: Record<string, string> = {
  "too-large": "圖片超過 10 MB，沒有上傳。",
  unsupported: "只能放 PNG、JPEG 或 GIF 圖片。",
  empty: "這個檔案是空的。",
};

/** Uploads an image; on failure, the message to show instead. */
export async function uploadImage(
  file: Blob
): Promise<{ ok: true; asset: Uploaded } | { ok: false; message: string }> {
  if (file.size > ASSET_MAX_BYTES) {
    return { ok: false, message: MESSAGES["too-large"] };
  }
  try {
    const response = await fetch("/api/assets", {
      method: "POST",
      body: file,
      headers: { "content-type": file.type || "application/octet-stream" },
    });
    const body = (await response.json().catch(() => ({}))) as Partial<
      Uploaded & { error: string }
    >;
    if (response.ok && body.sha256 && body.width && body.height) {
      return {
        ok: true,
        asset: { sha256: body.sha256, width: body.width, height: body.height },
      };
    }
    return {
      ok: false,
      message: MESSAGES[body.error ?? ""] ?? "圖片沒有上傳成功。",
    };
  } catch {
    return { ok: false, message: "圖片沒有上傳成功，請檢查網路。" };
  }
}
