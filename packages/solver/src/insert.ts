import { evaluateOrder } from './evaluate.js';
import type { SolveInput, SolveResult, Stage } from './types.js';
import { InvalidInputError, validateInput } from './validate.js';

/**
 * Minimal change: add one stage to an existing order without reordering anything.
 * Tries every position and keeps the one that adds the least (least lateness first,
 * then earliest arrival at the end). On a tie the earliest position wins.
 *
 * `input.stages` holds the stages already in the day; `newStage` is not in it yet.
 */
export function insertStage(
  input: SolveInput,
  currentOrder: string[],
  newStage: Stage,
): SolveResult {
  const withNew: SolveInput = { ...input, stages: [...input.stages, newStage] };
  validateInput(withNew);

  let best: SolveResult | null = null;
  for (let position = 0; position <= currentOrder.length; position++) {
    const order = [
      ...currentOrder.slice(0, position),
      newStage.id,
      ...currentOrder.slice(position),
    ];
    const candidate = evaluateOrder(withNew, order);
    if (
      !best ||
      candidate.totalLateness < best.totalLateness ||
      (candidate.totalLateness === best.totalLateness && candidate.endArrival < best.endArrival)
    ) {
      best = candidate;
    }
  }
  return best!;
}

/** Minimal change: skip one stage; everything else keeps its order and just shifts earlier. */
export function removeStage(
  input: SolveInput,
  currentOrder: string[],
  stageId: string,
): SolveResult {
  if (!currentOrder.includes(stageId)) {
    throw new InvalidInputError(`Stage ${stageId} is not in the current order`);
  }
  return evaluateOrder(
    { ...input, stages: input.stages.filter((s) => s.id !== stageId) },
    currentOrder.filter((id) => id !== stageId),
  );
}
