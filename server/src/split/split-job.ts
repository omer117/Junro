import { splitSegment, type SplitInput, type SplitResult } from '@junro/solver';
import type { TravelMode } from '../db/schema.js';
import { estimateTravelTime } from '../travel/estimate.js';

/** A split as plain data (a function cannot be sent to a worker, so the travel mode is sent). */
export type SplitJob = Omit<SplitInput, 'travelTime'> & { mode: TravelMode };

/** Runs a split in this thread. The worker calls this too, so both give the same answer. */
export function runSplitJob(job: SplitJob): SplitResult {
  const { mode, ...rest } = job;
  return splitSegment({ ...rest, travelTime: estimateTravelTime(mode) });
}

/** How a split is run: in a worker thread in production, inline in tests. */
export type SplitRunner = (job: SplitJob) => Promise<SplitResult>;
