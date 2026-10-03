// Server only: imports run in a worker thread, so reading a large or hostile
// file neither stalls other requests nor takes the server's memory. The
// worker is scripts/import-worker.ts, bundled into the image as
// dist/import-worker.mjs; outside production, imports run in-process unless
// IMPORT_WORKER names a bundle.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import { type ImportJob, type ImportOutcome, runImportJob } from "./job";

/** Imports are busy, or one ran past its time; the request should be retried. */
export class ImportBusyError extends Error {
  constructor(readonly reason: "busy" | "timeout") {
    super(reason === "busy" ? "too many imports waiting" : "import timed out");
  }
}

/**
 * How many imports run at once, how many may wait, how long one may take
 * (past the importer's own 20 s budget, which it checks between slides) and
 * how much heap its worker may use.
 */
export const IMPORT_LIMITS = {
  running: 1,
  waiting: 4,
  timeoutMs: 30_000,
  heapMb: 1024,
};

function workerFile(): string | null {
  if (process.env.IMPORT_WORKER) return process.env.IMPORT_WORKER;
  if (process.env.NODE_ENV !== "production") return null;
  return join(process.cwd(), "dist", "import-worker.mjs");
}

let running = 0;
const queue: (() => void)[] = [];

/** Runs an import job in a worker of its own, a few at a time. */
export async function importInWorker(
  job: ImportJob,
  limits = IMPORT_LIMITS
): Promise<ImportOutcome> {
  if (running >= limits.running) {
    if (queue.length >= limits.waiting) throw new ImportBusyError("busy");
    // A finishing import hands its slot over, so the count stays exact.
    await new Promise<void>((resolve) => queue.push(resolve));
  } else {
    running++;
  }
  try {
    const file = workerFile();
    if (!file) return await runImportJob(job);
    if (!existsSync(/* turbopackIgnore: true */ file))
      throw new Error(`no import worker at ${file}`);
    return await new Promise<ImportOutcome>((resolve, reject) => {
      // A bundle of its own, loaded at run time. Built through Reflect, as
      // the app's bundler takes `new Worker(path)` for a module to bundle.
      const worker: Worker = Reflect.construct(Worker, [
        file,
        {
          workerData: job,
          resourceLimits: { maxOldGenerationSizeMb: limits.heapMb },
        },
      ]);
      const timer = setTimeout(() => {
        reject(new ImportBusyError("timeout"));
        void worker.terminate();
      }, limits.timeoutMs);
      worker.once("message", (outcome: ImportOutcome) => {
        clearTimeout(timer);
        resolve(outcome);
        void worker.terminate();
      });
      worker.once("error", (error: Error & { code?: string }) => {
        clearTimeout(timer);
        // A file that needs more memory than the worker has is too large.
        if (error.code === "ERR_WORKER_OUT_OF_MEMORY") {
          resolve({ ok: false, code: "too-large" });
        } else {
          reject(error);
        }
      });
      // Settled already, unless the worker ended without answering.
      worker.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`the import worker exited with ${code}`));
      });
    });
  } finally {
    const next = queue.shift();
    if (next) next();
    else running--;
  }
}
