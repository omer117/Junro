import { Worker } from 'node:worker_threads';
import type { SplitResult } from '@junro/solver';
import type { SplitJob } from './split-job.js';

/**
 * Runs a split in a worker thread (Node's built-in threads, no new dependency), so a long
 * calculation does not block the Express event loop for everybody else.
 *
 * The server runs TypeScript through tsx, so the worker loads tsx too.
 */
export function runSplitInWorker(job: SplitJob): Promise<SplitResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./split-worker.ts', import.meta.url), {
      workerData: job,
      execArgv: ['--import', 'tsx'],
    });
    worker.once('message', (message: { result: SplitResult }) => resolve(message.result));
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`The split worker stopped with code ${code}`));
    });
  });
}
