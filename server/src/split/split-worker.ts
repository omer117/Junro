import { parentPort, workerData } from 'node:worker_threads';
import { runSplitJob, type SplitJob } from './split-job.js';

// Runs one split in its own thread and sends the answer back. A split can take a few seconds of
// pure computation; doing it here keeps the web server answering other people meanwhile.
parentPort!.postMessage({ result: runSplitJob(workerData as SplitJob) });
