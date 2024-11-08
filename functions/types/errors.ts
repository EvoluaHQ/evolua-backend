export class MaxScansExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaxScansExceededError";
  }
}