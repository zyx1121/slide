// The import worker: reads one .pptx off the request thread and answers
// with the outcome (lib/pptx/pool.ts). The Docker image runs a bundled copy
// of this file (`bun run build:worker`).
import { parentPort, workerData } from "node:worker_threads";

import { type ImportJob, runImportJob } from "../lib/pptx/job";

runImportJob(workerData as ImportJob).then((outcome) =>
  parentPort!.postMessage(outcome)
);
