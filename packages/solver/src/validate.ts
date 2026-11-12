import type { SolveInput } from './types.js';

/** The input cannot be solved as given (bad numbers, duplicate ids, unknown id...). */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

/** Travel time was Infinity or NaN everywhere, so no order of the stages can be driven. */
export class UnreachableError extends Error {
  constructor() {
    super('No order of the stages has a reachable route (travel time was Infinity or NaN)');
    this.name = 'UnreachableError';
  }
}

/** Exact DP needs 2^n memory; beyond this we refuse instead of freezing. */
export const MAX_STAGES = 15;

export function validateInput(input: SolveInput): void {
  if (input.stages.length > MAX_STAGES) {
    throw new RangeError(`Too many stages: ${input.stages.length} (the maximum is ${MAX_STAGES})`);
  }
  if (!Number.isFinite(input.startTime)) {
    throw new InvalidInputError('startTime must be a finite number');
  }

  const seen = new Set<string>();
  for (const stage of input.stages) {
    if (seen.has(stage.id)) throw new InvalidInputError(`Duplicate stage id: ${stage.id}`);
    seen.add(stage.id);

    if (!Number.isFinite(stage.stayMinutes) || stage.stayMinutes < 0) {
      throw new InvalidInputError(`Stage ${stage.id}: stayMinutes must be a number >= 0`);
    }
    const { window } = stage;
    if (
      window &&
      !(Number.isFinite(window.open) && Number.isFinite(window.close) && window.close > window.open)
    ) {
      throw new InvalidInputError(`Stage ${stage.id}: the window must close after it opens`);
    }
  }
}
