import { z } from 'zod';
import { HttpError } from '../errors.js';

/** A malformed id can never match a row, so it is a 404, not a 500 from the database. */
export function uuidParam(value: unknown): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new HttpError(404, 'not_found', 'Not found');
  return parsed.data;
}

export const notFoundError = () => new HttpError(404, 'not_found', 'Not found');
