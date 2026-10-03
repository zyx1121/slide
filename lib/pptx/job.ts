// One .pptx read into a deck, its pictures checked but not stored: the work
// an import worker does (scripts/import-worker.ts, run by lib/pptx/pool.ts).
import { AssetError, inspectAsset, slideAssets } from "../assets/store";
import { type ImportResult, importPptx } from "./import";
import { PptxError } from "./read";

export type ImportJob = { bytes: Uint8Array; fallbackTitle?: string };

export type ImportOutcome =
  | {
      ok: true;
      result: ImportResult;
      /** The pictures the deck draws, by sha256, to store. */
      pictures: [string, Uint8Array][];
    }
  | {
      ok: false;
      code: PptxError["code"];
      /** Set when the importer itself failed: a bug, not the file. */
      bug?: string;
    };

export async function runImportJob(job: ImportJob): Promise<ImportOutcome> {
  const pictures = new Map<string, Uint8Array>();
  try {
    const result = await importPptx(
      job.bytes,
      async (image) => {
        try {
          const { sha256 } = inspectAsset(image);
          // A copy: the bytes are a view into the unpacked file, which
          // would be copied whole on the way out of the worker.
          if (!pictures.has(sha256)) pictures.set(sha256, image.slice());
          return { sha256 };
        } catch (error) {
          if (error instanceof AssetError) return null;
          throw error;
        }
      },
      job.fallbackTitle
    );
    // Only the pictures the deck draws: shapes over the limits were dropped.
    const drawn = new Set(result.document.slides.flatMap(slideAssets));
    return {
      ok: true,
      result,
      pictures: [...pictures].filter(([sha256]) => drawn.has(sha256)),
    };
  } catch (error) {
    if (error instanceof PptxError) return { ok: false, code: error.code };
    return {
      ok: false,
      code: "malformed",
      bug:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    };
  }
}
