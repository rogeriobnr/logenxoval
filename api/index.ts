/**
 * Função serverless da API (Vercel Node runtime).
 * Encaminha a requisição original para o Fastify via light-my-request
 * (app.inject) — mantém as rotas como são (`/auth/*`, `/deposits/*`, ...).
 * O mesmo Fastify fica em cache entre invocações (warm start).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { getApp } from '../apps/server/dist/serverlessApp.js';

/** Normaliza a URL recebida: Vercel pode passar `/api`, `/api/…` ou o path original. */
function normalizedUrl(raw: string): string {
  const cleaned = raw.replace(/^\/api(\/index\.ts)?/, '');
  return cleaned === '' ? '/' : cleaned;
}

/** Lê o corpo sempre do stream cru — o runtime do Vercel não expõe `req.body` de forma confiável. */
async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/** Guarda contra invocações que travem no limite de tempo da plataforma. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout no ${label}`)), ms),
    ),
  ]);
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let app: FastifyInstance | null = null;
  try {
    app = await withTimeout(getApp(), 15000, 'getApp');
    const payload = await withTimeout(readRaw(req), 10000, 'readRaw');

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    delete headers['connection'];
    delete headers['transfer-encoding'];
    delete headers['host'];
    headers['content-length'] = String(payload.length);

    const result = await withTimeout(
      app.inject({
        method: (req.method ?? 'GET') as
          | 'GET'
          | 'POST'
          | 'PATCH'
          | 'DELETE'
          | 'PUT'
          | 'HEAD'
          | 'OPTIONS',
        url: normalizedUrl(req.url ?? '/'),
        headers,
        payload,
      }),
      15000,
      'inject',
    );

    res.statusCode = result.statusCode;
    for (const [k, v] of Object.entries(result.headers)) {
      if (v === undefined) continue;
      if (/^content-length$/i.test(k)) continue;
      res.setHeader(k, Array.isArray(v) ? v.join(', ') : String(v));
    }
    res.end(result.rawPayload ?? Buffer.from(result.payload || ''));
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          error: { code: 'INTERNAL', message: (err as Error).message },
        }),
      );
    } else {
      res.end();
    }
  }
}