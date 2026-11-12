/** The input cannot be solved as given (bad numbers, duplicate ids, unknown id...). */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}
