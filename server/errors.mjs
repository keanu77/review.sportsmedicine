export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const conflict = () => new ApiError(409, 'STATE_CONFLICT', 'The job changed or this action is not allowed in its current state');
export const staleLease = () => new ApiError(409, 'STALE_LEASE', 'This attempt is no longer active; stop work and discard its result');
