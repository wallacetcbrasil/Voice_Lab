import type { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
  }
}

export const asyncRoute =
  (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export function errorMiddleware(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const appError = error instanceof AppError
    ? error
    : new AppError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Erro inesperado.");
  res.status(appError.status).json({
    ok: false,
    error: {
      code: appError.code,
      message: appError.message,
      hint: appError.hint,
      requestId: res.locals.requestId,
    },
  });
}
