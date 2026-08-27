export class AppError extends Error {
  readonly statusCode: number;
  readonly isOperational = true;
  readonly details: unknown;

  constructor(message: string, statusCode = 400, details: unknown = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'AppError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'ConflictError';
  }
}
