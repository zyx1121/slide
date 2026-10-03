// Runs imports in a real worker: the bundle is built as the image builds it.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import { exportPptx } from "./export";
import { IMPORT_LIMITS, ImportBusyError, importInWorker } from "./pool";

const deck = () => new Uint8Array(exportPptx(sampleDocument(), new Map()));

beforeAll(() => {
  const out = join(mkdtempSync(join(tmpdir(), "slide-worker-")), "w.mjs");
  execFileSync("bun", [
    "build",
    "scripts/import-worker.ts",
    "--target=node",
    `--outfile=${out}`,
  ]);
  process.env.IMPORT_WORKER = out;
}, 60_000);

afterAll(() => {
  delete process.env.IMPORT_WORKER;
});

describe("importInWorker", () => {
  it("reads a deck in a worker thread", async () => {
    const outcome = await importInWorker({ bytes: deck(), fallbackTitle: "x" });
    expect(outcome.ok && outcome.result.document.slides.length).toBe(
      sampleDocument().slides.length
    );
    const refused = await importInWorker({ bytes: new Uint8Array([1, 2, 3]) });
    expect(refused).toEqual({ ok: false, code: "not-pptx" });
  });

  it("gives up on an import that runs past its time", async () => {
    await expect(
      importInWorker({ bytes: deck() }, { ...IMPORT_LIMITS, timeoutMs: 1 })
    ).rejects.toEqual(new ImportBusyError("timeout"));
    // The slot is free again.
    expect((await importInWorker({ bytes: deck() })).ok).toBe(true);
  });

  it("turns away imports past the queue", async () => {
    const limits = { ...IMPORT_LIMITS, running: 1, waiting: 0 };
    const first = importInWorker({ bytes: deck() }, limits);
    await expect(importInWorker({ bytes: deck() }, limits)).rejects.toEqual(
      new ImportBusyError("busy")
    );
    expect((await first).ok).toBe(true);
  });

  it("answers too large when the worker runs out of memory", async () => {
    // A deck whose slides add up to far more than a 4 MB heap.
    const doc = sampleDocument();
    doc.slides = Array.from({ length: 200 }, (_, i) => ({
      ...doc.slides[0],
      id: `sl_many${i}`,
      shapes: doc.slides[0].shapes.map((shape) => ({
        ...shape,
        id: `${shape.id}${i}`,
      })),
    }));
    const outcome = await importInWorker(
      { bytes: new Uint8Array(exportPptx(doc, new Map())) },
      { ...IMPORT_LIMITS, heapMb: 4 }
    );
    expect(outcome).toEqual({ ok: false, code: "too-large" });
  });
});
