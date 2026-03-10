export class SiloError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
export class NotFoundError extends SiloError {}
export class ConflictError extends SiloError {}
export class ValidationError extends SiloError {}
export class GateError extends SiloError {}
export class InternalError extends SiloError {}
