/**
 * Crypto do cliente — PBKDF2 local (docs 3.1/3.3/3.4).
 * A senha local NUNCA é armazenada; só o hash PBKDF2 com salt do device.
 */

const enc = new TextEncoder();
const ITERACOES = 100_000;

function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** Deriva o verifier local (hash) a partir de senha + salt do dispositivo. */
export async function deriveLocalVerifier(senha: string, salt: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: ITERACOES, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return bytesToBase64(bits);
}

/** Comparação em tempo constante-ish; útil para o login offline. */
export function verifierIgual(stored: string, computed: string): boolean {
  const a = base64ToBytes(stored);
  const b = base64ToBytes(computed);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}