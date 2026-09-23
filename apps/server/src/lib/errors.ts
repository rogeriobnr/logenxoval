import type { ZodError } from 'zod';

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'PERMISSAO_NEGADA'
  | 'DEPOSITO_NAO_AUTORIZADO'
  | 'MATRICULA_INVALIDA'
  | 'VALIDATION_FAILED'
  | 'NAO_ENCONTRADO'
  | 'CONFLITO'
  | 'OPERATION_DUPLICADA'
  | 'CONFLITO_PENDENTE'
  | 'OPERACAO_NEGADA'
  | 'CONFIG_INVALIDA';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function zodToAppError(err: ZodError): AppError {
  return new AppError(
    'VALIDATION_FAILED',
    'Dados inválidos',
    400,
    err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

export function errorResponse(err: unknown) {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      body: { error: { code: err.code, message: err.message, details: err.details } },
    };
  }
  const msg = err instanceof Error ? err.message : 'Erro interno';
  return {
    statusCode: 500,
    body: { error: { code: 'INTERNAL', message: msg } },
  };
}