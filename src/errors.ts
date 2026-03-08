export class DefconError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "DefconError";
  }
}
export class NotFoundError extends DefconError {
  constructor(msg: string) {
    super(msg);
    this.name = "NotFoundError";
  }
}
export class ConflictError extends DefconError {
  constructor(msg: string) {
    super(msg);
    this.name = "ConflictError";
  }
}
export class ValidationError extends DefconError {
  constructor(msg: string) {
    super(msg);
    this.name = "ValidationError";
  }
}
export class GateError extends DefconError {
  constructor(msg: string) {
    super(msg);
    this.name = "GateError";
  }
}
