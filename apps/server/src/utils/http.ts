import { StatusCodes } from "http-status-codes";

export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function badRequest(message: string): never {
  throw new HttpError(StatusCodes.BAD_REQUEST, message);
}

export function unauthorized(message = "Unauthorized"): never {
  throw new HttpError(StatusCodes.UNAUTHORIZED, message);
}

export function forbidden(message = "Forbidden"): never {
  throw new HttpError(StatusCodes.FORBIDDEN, message);
}

export function notFound(message = "Not found"): never {
  throw new HttpError(StatusCodes.NOT_FOUND, message);
}
