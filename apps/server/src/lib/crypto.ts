import { randomUUID, createHash } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

export function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function newToken(byteLength = 32): string {
  return createHash('sha256').update(randomUUID() + randomUUID() + Date.now()).digest('hex').slice(0, byteLength * 2);
}