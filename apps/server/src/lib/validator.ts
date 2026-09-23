import type { ZodSchema, z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { zodToAppError } from './errors';

export function validateBody<T extends ZodSchema>(schema: T) {
  return {
    preValidation: async (req: FastifyRequest) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) throw zodToAppError(parsed.error);
      (req as { body: z.infer<T> }).body = parsed.data;
    },
  };
}